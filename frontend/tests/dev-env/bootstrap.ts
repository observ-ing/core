/**
 * SPIKE: boot a local @atproto/dev-env network for e2e isolation.
 *
 * Goal: prove that observ.ing's "live lexicon + blob" e2e path can run against
 * a throwaway, fully local ATProto network (PLC + PDS + firehose) so test
 * records NEVER reach the public firehose and therefore never appear on our
 * production site OR any other AppView.
 *
 * What this proves (the dev-env half):
 *   - boots PLC + PDS with random ports
 *   - creates a real account (handle/DID/app-password) on the local PDS
 *   - uploads a blob (stand-in for a PDF/photo) to that account's repo
 *   - writes a real `bio.lexicons.temp.v0-1.occurrence` record referencing it
 *   - prints every endpoint the Rust services would need to be pointed at
 *
 * What it does NOT do yet (the integration half — see README.md):
 *   - point observing-appview's PLC/handle resolver at this local PLC
 *   - point tap-ingester / the tap binary at this local PDS firehose + PLC
 *   - drive OAuth login against the dev-env PDS login UI
 *
 * Run:  npx tsx frontend/tests/dev-env/bootstrap.ts          (boot, print, exit)
 *       npx tsx frontend/tests/dev-env/bootstrap.ts --serve  (boot, print, stay up)
 */

import { AtpAgent } from "@atproto/api";
import { TestNetworkNoAppView } from "@atproto/dev-env";

// Mirrors crates/observing-collections OCCURRENCE_COLLECTION.
const OCCURRENCE_COLLECTION = "bio.lexicons.temp.v0-1.occurrence";

async function main() {
  const serve = process.argv.includes("--serve");

  // Boots an in-process PLC (DID directory) + PDS (personal data server) on
  // random free ports. No public relay is involved — nothing federates.
  const network = await TestNetworkNoAppView.create({
    dbPostgresSchema: "dev_env_spike",
  });

  const pdsUrl = network.pds.url;
  const plcUrl = network.plc.url;
  const firehoseUrl = `${pdsUrl.replace(/^http/, "ws")}/xrpc/com.atproto.sync.subscribeRepos`;

  // Create a real account on the local PDS. handle domain ".test" is the
  // dev-env default available user domain.
  const sc = network.getSeedClient();
  const password = "spike-test-pw";
  const account = await sc.createAccount("alice", {
    handle: "alice.test",
    email: "alice@example.test",
    password,
  });

  // Log in as that account and exercise the real blob + record path.
  const agent = new AtpAgent({ service: pdsUrl });
  await agent.login({ identifier: account.handle, password });

  // Upload a tiny blob — stands in for a PDF / observation photo.
  const fakeImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]); // JPEG-ish magic
  const blobRes = await agent.com.atproto.repo.uploadBlob(fakeImage, {
    encoding: "image/jpeg",
  });

  // Write a real occurrence record against the production lexicon NSID.
  // The PDS stores unknown-lexicon records as-is (no schema enforcement),
  // so this matches what the live app writes.
  // NOTE: ATProto's data model forbids floats, so coordinates are strings here
  // (the real lexicon encodes them as strings / scaled ints for the same reason).
  const record = {
    $type: OCCURRENCE_COLLECTION,
    eventDate: "2026-06-09",
    decimalLatitude: "37.7749",
    decimalLongitude: "-122.4194",
    coordinateUncertaintyInMeters: 10,
    createdAt: "2026-06-09T00:00:00.000Z",
    media: [{ blob: blobRes.data.blob, alt: "spike" }],
  };
  const putRes = await agent.com.atproto.repo.putRecord({
    repo: account.did,
    collection: OCCURRENCE_COLLECTION,
    rkey: "spike1",
    record,
  });

  const summary = {
    plcUrl,
    pdsUrl,
    firehoseUrl,
    account: {
      did: account.did,
      handle: account.handle,
      password,
    },
    occurrenceUri: putRes.data.uri,
    blobCid: blobRes.data.blob.ref.toString(),
  };

  // eslint-disable-next-line no-console
  console.log("\n=== dev-env spike: endpoints + seeded data ===");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    "\nThese are the URLs the Rust services would be pointed at " +
      "(PLC_DIRECTORY_URL, PDS firehose, etc.) — see README.md.",
  );

  if (serve) {
    console.log("\n--serve: network staying up. Ctrl-C to tear down.\n");
    await new Promise<void>((resolve) => {
      process.on("SIGINT", resolve);
      process.on("SIGTERM", resolve);
    });
  }

  await network.close();
  console.log("dev-env network closed.");
}

main().catch((err) => {
  console.error("spike failed:", err);
  process.exit(1);
});
