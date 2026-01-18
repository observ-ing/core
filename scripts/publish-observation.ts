/**
 * Script to publish an org.rwell.test.occurrence record to a PDS
 *
 * Usage:
 *   PDS_URL=http://localhost:2583 \
 *   HANDLE=test.local \
 *   PASSWORD=password \
 *   tsx scripts/publish-observation.ts
 *
 * Or with Bluesky:
 *   PDS_URL=https://bsky.social \
 *   HANDLE=yourhandle.bsky.social \
 *   PASSWORD=your-app-password \
 *   tsx scripts/publish-observation.ts
 */

import { AtpAgent } from "@atproto/api";
import {
  OrgRwellTestOccurrence,
  ids,
} from "biosky-shared";

const COLLECTION = ids.OrgRwellTestOccurrence;

interface PublishResult {
  uri: string;
  cid: string;
}

async function createAgent(): Promise<AtpAgent> {
  const pdsUrl = process.env.PDS_URL || "http://localhost:2583";
  const handle = process.env.HANDLE;
  const password = process.env.PASSWORD;

  if (!handle || !password) {
    throw new Error("HANDLE and PASSWORD environment variables are required");
  }

  const agent = new AtpAgent({ service: pdsUrl });

  console.log(`Logging in to ${pdsUrl} as ${handle}...`);
  await agent.login({ identifier: handle, password });
  console.log("Login successful!");

  return agent;
}

interface OccurrenceInput {
  scientificName: string;
  eventDate: string;
  location: OrgRwellTestOccurrence.Location;
  verbatimLocality?: string;
  blobs?: OrgRwellTestOccurrence.ImageEmbed[];
  notes?: string;
  createdAt: string;
}

async function publishObservation(
  agent: AtpAgent,
  observation: OccurrenceInput
): Promise<PublishResult> {
  // Validate the observation
  const result = OrgRwellTestOccurrence.validateMain({
    $type: COLLECTION,
    ...observation,
  });
  if (!result.success) {
    throw new Error(`Invalid observation: ${result.error.message}`);
  }

  console.log("Publishing observation...");
  console.log(`  Scientific Name: ${observation.scientificName}`);
  console.log(`  Event Date: ${observation.eventDate}`);
  console.log(
    `  Location: ${observation.location.decimalLatitude}, ${observation.location.decimalLongitude}`
  );

  const record = {
    $type: COLLECTION,
    ...observation,
  };

  const response = await agent.com.atproto.repo.createRecord({
    repo: agent.session!.did,
    collection: COLLECTION,
    record,
  });

  console.log("Observation published successfully!");
  console.log(`  URI: ${response.data.uri}`);
  console.log(`  CID: ${response.data.cid}`);

  return {
    uri: response.data.uri,
    cid: response.data.cid,
  };
}

// Example observation: California Poppy in San Francisco
async function main() {
  const agent = await createAgent();

  // Example observation following Darwin Core standards
  const observation: OccurrenceInput = {
    scientificName: "Eschscholzia californica",
    eventDate: new Date().toISOString(),
    location: {
      decimalLatitude: "37.7749",
      decimalLongitude: "-122.4194",
      coordinateUncertaintyInMeters: 10,
      geodeticDatum: "WGS84",
    },
    verbatimLocality: "Golden Gate Park, San Francisco, California, USA",
    notes:
      "Beautiful orange California Poppy blooming along the hiking trail. Multiple individuals observed.",
    createdAt: new Date().toISOString(),
  };

  const result = await publishObservation(agent, observation);

  console.log("\nTo view this record, use:");
  console.log(
    `  curl "${agent.service}/xrpc/com.atproto.repo.getRecord?repo=${agent.session!.did}&collection=${COLLECTION}&rkey=${result.uri.split("/").pop()}"`
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

export { createAgent, publishObservation };
