/**
 * SPIKE / demo: boot a local @atproto/dev-env network and exercise the
 * "live lexicon + blob" path against it, proving test records can be created
 * fully locally (never reaching the public firehose, production, or any other
 * AppView). See README.md for the full integration story.
 *
 * For the actual e2e wiring see scripts/e2e-devenv.ts, which reuses
 * network.ts to boot the same network and point the Rust services at it.
 *
 * Run:  npx tsx frontend/tests/dev-env/bootstrap.ts          (boot, print, exit)
 *       npx tsx frontend/tests/dev-env/bootstrap.ts --serve  (boot, print, stay up)
 */

import { AtpAgent } from "@atproto/api";
import { bootDevEnv } from "./network";

// Mirrors crates/observing-collections OCCURRENCE_COLLECTION.
const OCCURRENCE_COLLECTION = "bio.lexicons.temp.v0-1.occurrence";

async function main() {
  const serve = process.argv.includes("--serve");
  const dev = await bootDevEnv();

  // Log in as the seeded account and exercise the real blob + record path.
  const agent = new AtpAgent({ service: dev.endpoints.pdsUrl });
  await agent.login({ identifier: dev.account.handle, password: dev.account.password });

  // Upload a tiny blob — stands in for a PDF / observation photo.
  const fakeImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]); // JPEG-ish magic
  const blobRes = await agent.com.atproto.repo.uploadBlob(fakeImage, {
    encoding: "image/jpeg",
  });

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
    repo: dev.account.did,
    collection: OCCURRENCE_COLLECTION,
    rkey: "spike1",
    record,
  });

  const summary = {
    ...dev.endpoints,
    account: dev.account,
    occurrenceUri: putRes.data.uri,
    blobCid: blobRes.data.blob.ref.toString(),
  };

  console.log("\n=== dev-env: endpoints + seeded data ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    "\nThese URLs are what scripts/e2e-devenv.ts feeds the Rust services as " +
      "PLC_DIRECTORY_URL / HANDLE_RESOLVER_URL / TAP_RELAY_URL.",
  );

  if (serve) {
    console.log("\n--serve: network staying up. Ctrl-C to tear down.\n");
    await new Promise<void>((resolve) => {
      process.on("SIGINT", resolve);
      process.on("SIGTERM", resolve);
    });
  }

  await dev.close();
  console.log("dev-env network closed.");
}

main().catch((err) => {
  console.error("bootstrap failed:", err);
  process.exit(1);
});
