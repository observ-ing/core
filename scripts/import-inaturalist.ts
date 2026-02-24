/**
 * Import the last 100 iNaturalist observations for a user as AT Protocol records.
 *
 * Usage:
 *   npx tsx scripts/import-inaturalist.ts <inat_username> <atp_handle> <atp_app_password>
 *
 * Example:
 *   npx tsx scripts/import-inaturalist.ts kueda alice.bsky.social xxxx-xxxx-xxxx-xxxx
 *
 * This script:
 *   1. Fetches the last 100 geo-tagged observations from iNaturalist
 *   2. Downloads each photo and uploads it as a blob to your PDS
 *   3. Creates org.rwell.test.occurrence records on your PDS
 */

import { AtpAgent } from "@atproto/api";

const INAT_API = "https://api.inaturalist.org/v1";
const OCCURRENCE_COLLECTION = "org.rwell.test.occurrence";
const IDENTIFICATION_COLLECTION = "org.rwell.test.identification";

const LICENSE_MAP: Record<string, string> = {
  cc0: "CC0-1.0",
  "cc-by": "CC-BY-4.0",
  "cc-by-nc": "CC-BY-NC-4.0",
  "cc-by-sa": "CC-BY-SA-4.0",
  "cc-by-nc-sa": "CC-BY-NC-SA-4.0",
};

interface Ancestor {
  id: number;
  name: string;
  rank: string;
  rank_level: number;
}

function extractTaxonomyFromAncestors(identifications: any[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!identifications?.length) return result;

  // Find an identification with ancestors
  for (const ident of identifications) {
    const ancestors: Ancestor[] | undefined = ident.taxon?.ancestors;
    if (!ancestors?.length) continue;

    for (const a of ancestors) {
      switch (a.rank) {
        case "kingdom":
          result["kingdom"] = a.name;
          break;
        case "phylum":
          result["phylum"] = a.name;
          break;
        case "class":
          result["class"] = a.name;
          break;
        case "order":
          result["order"] = a.name;
          break;
        case "family":
          result["family"] = a.name;
          break;
        case "genus":
          result["genus"] = a.name;
          break;
      }
    }
    break; // use first identification with ancestors
  }
  return result;
}

async function downloadImage(url: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const buffer = await resp.arrayBuffer();
    return { data: new Uint8Array(buffer), mimeType: contentType };
  } catch {
    return null;
  }
}

async function main() {
  const [inatUsername, atpHandle, atpPassword] = process.argv.slice(2);

  if (!inatUsername || !atpHandle || !atpPassword) {
    console.error(
      "Usage: npx tsx scripts/import-inaturalist.ts <inat_username> <atp_handle> <atp_app_password>",
    );
    console.error("");
    console.error("Arguments:");
    console.error("  inat_username    iNaturalist username");
    console.error("  atp_handle       AT Protocol handle (e.g. alice.bsky.social)");
    console.error("  atp_app_password AT Protocol app password");
    process.exit(1);
  }

  // Authenticate with AT Protocol
  console.log(`Logging in as ${atpHandle}...`);
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: atpHandle, password: atpPassword });
  const did = agent.session!.did;
  console.log(`Authenticated as ${did}`);

  // Fetch iNaturalist observations
  const url = `${INAT_API}/observations?user_login=${encodeURIComponent(inatUsername)}&per_page=100&order=desc&order_by=created_at&geo=true`;
  console.log(`Fetching observations for ${inatUsername}...`);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`iNaturalist API error: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as {
    total_results: number;
    results: any[];
  };
  console.log(`Found ${data.total_results} total, processing ${data.results.length}`);

  let created = 0;
  let skipped = 0;

  for (const obs of data.results) {
    // Must have coordinates
    if (!obs.geojson?.coordinates) {
      console.log(`  Skip ${obs.id}: no coordinates`);
      skipped++;
      continue;
    }

    const [lng, lat] = obs.geojson.coordinates;
    const eventDate = obs.time_observed_at || obs.observed_on || obs.created_at;
    if (!eventDate) {
      console.log(`  Skip ${obs.id}: no date`);
      skipped++;
      continue;
    }

    // Upload photos as blobs
    const blobs: any[] = [];
    if (obs.photos?.length) {
      for (const photo of obs.photos.slice(0, 10)) {
        const imageUrl = photo.url?.replace("/square.", "/original.");
        if (!imageUrl) continue;

        console.log(`  Downloading photo ${photo.id}...`);
        const img = await downloadImage(imageUrl);
        if (!img) {
          console.log(`  Warning: failed to download photo ${photo.id}`);
          continue;
        }

        const uploadResp = await agent.uploadBlob(img.data, {
          encoding: img.mimeType,
        });

        blobs.push({
          image: uploadResp.data.blob,
          alt: photo.attribution || "",
          ...(photo.original_dimensions && {
            aspectRatio: {
              width: photo.original_dimensions.width,
              height: photo.original_dimensions.height,
            },
          }),
        });
      }
    }

    // Extract taxonomy
    const taxon = obs.taxon;
    const taxonomy = extractTaxonomyFromAncestors(obs.identifications);

    // Map license
    const license = obs.license_code ? LICENSE_MAP[obs.license_code] : undefined;

    // Build the occurrence record (no taxonomy — that goes on identification)
    const occurrenceRecord: Record<string, any> = {
      $type: OCCURRENCE_COLLECTION,
      eventDate: new Date(eventDate).toISOString(),
      location: {
        decimalLatitude: String(lat),
        decimalLongitude: String(lng),
        ...(obs.positional_accuracy && {
          coordinateUncertaintyInMeters: obs.positional_accuracy,
        }),
        geodeticDatum: "WGS84",
      },
      createdAt: new Date(obs.created_at).toISOString(),
    };

    if (obs.place_guess) occurrenceRecord["verbatimLocality"] = obs.place_guess;
    if (obs.description) occurrenceRecord["notes"] = obs.description;
    if (license) occurrenceRecord["license"] = license;
    if (blobs.length > 0) occurrenceRecord["blobs"] = blobs;

    // Create the occurrence record on the PDS
    try {
      const createResp = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: OCCURRENCE_COLLECTION,
        record: occurrenceRecord,
      });
      created++;
      console.log(
        `  Created occurrence: ${taxon?.name || "Unknown"} @ ${obs.place_guess || "Unknown"} → ${createResp.data.uri}`,
      );

      // Create an identification record if we have taxon info
      if (taxon?.name) {
        const taxonObj: Record<string, string> = {
          scientificName: taxon.name,
        };
        if (taxon.rank) taxonObj["taxonRank"] = taxon.rank;
        if (taxon.preferred_common_name) taxonObj["vernacularName"] = taxon.preferred_common_name;
        if (taxonomy["kingdom"]) taxonObj["kingdom"] = taxonomy["kingdom"];
        if (taxonomy["phylum"]) taxonObj["phylum"] = taxonomy["phylum"];
        if (taxonomy["class"]) taxonObj["class"] = taxonomy["class"];
        if (taxonomy["order"]) taxonObj["order"] = taxonomy["order"];
        if (taxonomy["family"]) taxonObj["family"] = taxonomy["family"];
        if (taxonomy["genus"]) taxonObj["genus"] = taxonomy["genus"];

        const identRecord = {
          $type: IDENTIFICATION_COLLECTION,
          subject: {
            uri: createResp.data.uri,
            cid: createResp.data.cid,
          },
          subjectIndex: 0,
          taxon: taxonObj,
          isAgreement: false,
          confidence: "high",
          createdAt: new Date(obs.created_at).toISOString(),
        };

        await agent.com.atproto.repo.createRecord({
          repo: did,
          collection: IDENTIFICATION_COLLECTION,
          record: identRecord,
        });
        console.log(`  Created identification: ${taxon.name}`);
      }
    } catch (err: any) {
      console.error(`  Error creating record for obs ${obs.id}:`, err.message);
    }

    // Small delay to be respectful to the PDS
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
