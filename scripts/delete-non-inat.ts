/**
 * Delete all org.rwell.test.occurrence records that were NOT imported from iNaturalist.
 * iNaturalist-imported records are identified by having taxonId starting with "inat:".
 *
 * Usage:
 *   npx tsx scripts/delete-non-inat.ts <atp_handle> <atp_app_password>
 */

import { AtpAgent } from "@atproto/api";

const COLLECTION = "org.rwell.test.occurrence";

async function main() {
  const [atpHandle, atpPassword] = process.argv.slice(2);

  if (!atpHandle || !atpPassword) {
    console.error(
      "Usage: npx tsx scripts/delete-non-inat.ts <atp_handle> <atp_app_password>",
    );
    process.exit(1);
  }

  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: atpHandle, password: atpPassword });
  const did = agent.session!.did;
  console.log(`Authenticated as ${did}`);

  // List all occurrence records
  let cursor: string | undefined;
  const toDelete: { uri: string; rkey: string; name: string }[] = [];
  const toKeep: string[] = [];

  do {
    const resp = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: COLLECTION,
      limit: 100,
      cursor,
    });

    for (const rec of resp.data.records) {
      const val = rec.value as any;
      const rkey = rec.uri.split("/").pop()!;

      if (val.taxonId && val.taxonId.startsWith("inat:")) {
        toKeep.push(
          `  KEEP: ${val.scientificName || "Unknown"} (${val.taxonId})`,
        );
      } else {
        toDelete.push({
          uri: rec.uri,
          rkey,
          name: val.scientificName || val.verbatimLocality || "Unknown",
        });
      }
    }

    cursor = resp.data.cursor;
  } while (cursor);

  console.log(`\nKeeping ${toKeep.length} iNaturalist records`);
  console.log(`Deleting ${toDelete.length} non-iNaturalist records:\n`);
  for (const d of toDelete) {
    console.log(`  DELETE: ${d.name} (${d.rkey})`);
  }

  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  // Delete
  console.log(`\nDeleting...`);
  let deleted = 0;
  for (const d of toDelete) {
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: COLLECTION,
      rkey: d.rkey,
    });
    deleted++;
    console.log(`  Deleted: ${d.name}`);
  }

  console.log(`\nDone! Deleted ${deleted} records, kept ${toKeep.length}.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
