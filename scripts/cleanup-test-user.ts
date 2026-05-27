/**
 * Delete every record the e2e test suite would create from the test
 * user's PDS. Run before the e2e CI job so that `/repos/add` on the
 * test DID has a small, bounded backfill to walk — otherwise the
 * accumulated history (#473) saturates tap-ingester's channel and the
 * test's live commit waits behind it.
 *
 * Idempotent. Safe to run repeatedly. Only touches collections the
 * e2e tests own.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-user.ts <handle> <password>
 */

import { AtpAgent } from "@atproto/api";

// Collections the e2e suite creates records in. Cleaning all of them
// (not just occurrence) prevents identifications/comments/likes from
// piling up across runs even though the CRUD test only writes to
// occurrence + identification — other suites cover the rest.
const COLLECTIONS = [
  "bio.lexicons.temp.v0-1.occurrence",
  "bio.lexicons.temp.v0-1.identification",
  "ing.observ.temp.comment",
  "ing.observ.temp.interaction",
  "ing.observ.temp.like",
];

async function main() {
  const [handle, password] = process.argv.slice(2);

  if (!handle || !password) {
    console.error("Usage: npx tsx scripts/cleanup-test-user.ts <handle> <password>");
    process.exit(1);
  }

  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password });
  const did = agent.session!.did;
  console.log(`Authenticated as ${did}`);

  let totalDeleted = 0;
  for (const collection of COLLECTIONS) {
    const deleted = await cleanupCollection(agent, did, collection);
    totalDeleted += deleted;
  }
  console.log(`\nDone — deleted ${totalDeleted} record(s) total.`);
}

async function cleanupCollection(
  agent: AtpAgent,
  did: string,
  collection: string,
): Promise<number> {
  const rkeys: string[] = [];

  let cursor: string | undefined;
  do {
    const resp = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: 100,
      ...(cursor !== undefined && { cursor }),
    });
    for (const rec of resp.data.records) {
      rkeys.push(rec.uri.split("/").pop()!);
    }
    cursor = resp.data.cursor;
  } while (cursor);

  if (rkeys.length === 0) {
    console.log(`  ${collection}: 0 records, nothing to delete`);
    return 0;
  }

  console.log(`  ${collection}: deleting ${rkeys.length} record(s)...`);
  // Sequential deletes — the PDS rate-limits aggressive parallelism,
  // and getting throttled mid-cleanup leaves the run in an odd half-state.
  for (const rkey of rkeys) {
    await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
  }
  return rkeys.length;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
