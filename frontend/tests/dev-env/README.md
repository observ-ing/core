# dev-env e2e isolation — SPIKE

Goal: run the "live lexicon + blob" e2e path against a **throwaway local ATProto
network** so test records never reach the public firehose — and therefore never
appear on our production site **or any other AppView**. This is the only approach
that fully satisfies "no other AppView picks up the DID" (DID-denylisting at our
own ingester only cleans _our_ view; the records still federate).

## Status: dev-env half PROVEN, Rust integration NOT done

`bootstrap.ts` boots `@atproto/dev-env`'s `TestNetworkNoAppView` (PLC + PDS +
firehose, random ports), creates a real account, uploads a blob, and writes a
real `bio.lexicons.temp.v0-1.occurrence` record. Run it:

```
npx tsx frontend/tests/dev-env/bootstrap.ts          # boot, print endpoints, tear down
npx tsx frontend/tests/dev-env/bootstrap.ts --serve  # stay up for manual wiring
```

Sample output (ports are random each run):

```json
{
  "plcUrl": "http://localhost:54176",
  "pdsUrl": "http://localhost:54177",
  "firehoseUrl": "ws://localhost:54177/xrpc/com.atproto.sync.subscribeRepos",
  "account": { "did": "did:plc:...", "handle": "alice.test", "password": "spike-test-pw" },
  "occurrenceUri": "at://did:plc:.../bio.lexicons.temp.v0-1.occurrence/spike1"
}
```

## What's left: point the Rust stack at those endpoints

dev-env hands us a PLC URL, a PDS URL, and a firehose URL. The blocker is that
our services **hardcode the public PLC (`plc.directory`)** and resolve handles
via DNS — none of which work for a local network. Required changes:

1. **appview identity/OAuth resolver** — `crates/observing-appview/src/state.rs`
   - `create_oauth_client`: `plc_directory_url: DEFAULT_PLC_DIRECTORY_URL`
     (line ~65) must read an env override, e.g. `PLC_DIRECTORY_URL`.
   - `AtprotoHandleResolver` (line ~68) resolves handles via DNS TXT / HTTPS
     well-known — neither works for `alice.test`. For the spike, log in by
     **DID** instead of handle, or point handle resolution at the PDS's
     `com.atproto.identity.resolveHandle`.
   - The `IdentityResolver` built in `main.rs` needs the same PLC override.

2. **blob resolver** — `crates/atproto-blob-resolver/src/resolver.rs` (line ~38)
   hardcodes `https://plc.directory/{did}`. Same env override.

3. **tap-ingester** — `crates/tap-ingester/src/main.rs`
   - The embedded `tap` (indigo) binary is spawned via
     `tapped::TapProcess::spawn_default` (line ~149) with no PLC / firehose
     source exposed in the builder. tap must (a) resolve the test DID via the
     **dev-env PLC** and (b) subscribe to the **dev-env PDS firehose**.
   - Two paths: extend `tapped` to pass `--plc-host` + firehose URL, OR run tap
     separately pointed at dev-env and set `TAP_URL` to connect to it.
   - This is the deepest unknown — verify tap (indigo) accepts a custom PLC host
     and a single-PDS firehose source before committing to the approach.

4. **OAuth login UI** — `frontend/tests/auth.setup.ts` drives **bsky.social's**
   HTML (password field, "Authorize" button). The dev-env PDS serves the
   `@atproto/pds` OAuth UI, which has different markup, so the setup selectors
   must be rewritten — or bypass OAuth by injecting a session row directly.

## Recommended sequencing

1. Land the PLC env override across the three Rust crates (items 1, 2) — small,
   localized, useful on its own.
2. Spike the tap ⇄ dev-env firehose link (item 3) in isolation — this is the
   make-or-break piece.
3. Rewrite `auth.setup.ts` for the dev-env login page (item 4).
4. Add a Playwright `globalSetup` that boots `bootstrap.ts`, exports the
   endpoints as env vars for the services, and tears down in `globalTeardown`.

## Caveats

- `@atproto/dev-env` pulls ~1260 transitive packages (incl. `@atproto/pds`,
  `@did-plc/server`). Heavy devDependency; keep it dev-only.
- ATProto's data model forbids floats, so coordinates must be strings / scaled
  ints (the spike learned this the hard way — see `bootstrap.ts`).
