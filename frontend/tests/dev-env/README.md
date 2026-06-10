# dev-env e2e isolation — SPIKE

Goal: run the "live lexicon + blob" e2e path against a **throwaway local ATProto
network** so test records never reach the public firehose — and therefore never
appear on our production site **or any other AppView**. This is the only approach
that fully satisfies "no other AppView picks up the DID" (DID-denylisting at our
own ingester only cleans _our_ view; the records still federate).

## Status: harness implemented; needs one live run to confirm

The full path is wired (`npm run test:e2e:devenv` — see "Running it" below). The
network half and the wiring are verified where possible; the end-to-end OAuth +
firehose round-trip needs a local run with Postgres + `tap` (see "Verified vs.
needs a live run").

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

## Pointing the Rust stack at the local network

dev-env hands us a PLC URL, a PDS URL, and a firehose URL. Three env vars now
redirect the stack at them (all no-op in production when unset):

| Var                   | Effect                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PLC_DIRECTORY_URL`   | did:plc resolution in appview OAuth, identity resolver, blob resolver, **and** Tap                            |
| `HANDLE_RESOLVER_URL` | handle→DID via `resolveHandle` against this URL instead of DNS/well-known (appview OAuth + identity resolver) |
| `TAP_RELAY_URL`       | upstream firehose Tap subscribes to — a relay or a single PDS's `subscribeRepos`                              |

For dev-env, set all three to the `bootstrap.ts` output, e.g.:

```
PLC_DIRECTORY_URL=http://localhost:54176
HANDLE_RESOLVER_URL=http://localhost:54177          # the PDS
TAP_RELAY_URL=ws://localhost:54177                  # the PDS firehose
```

### Done (this PR + follow-ups)

1. ✅ **PLC override** — shared `atproto_identity::plc_directory_url()` threaded
   through appview OAuth, `IdentityResolver`, and the blob resolver.
2. ✅ **Handle resolution** — `AppHandleResolver` enum swaps DNS (prod) for an
   AppView-style resolver (dev-env) via `HANDLE_RESOLVER_URL`;
   `IdentityResolver::from_env()` honors the same var.
3. ✅ **tap-ingester firehose** — `tapped` already exposes `plc_url` / `relay_url`
   (passed to the binary as `TAP_PLC_URL` / `TAP_RELAY_URL`); the spawn path now
   sets them from `PLC_DIRECTORY_URL` / `TAP_RELAY_URL`. A PDS serves
   `subscribeRepos` just like a relay, so `TAP_RELAY_URL` can point straight at
   the dev-env PDS — no separate relay needed.

4. ✅ **OAuth login UI** — `devenv-auth.setup.ts` drives the dev-env PDS
   (`@atproto/oauth-provider-ui`) login + consent screens. Selectors taken from
   that package's source: `input[name="username"]`, `input[name="password"]`,
   "Sign in", then "Authorize". It writes the same `playwright/.auth/*` files as
   the bsky setup, so `e2e.spec.ts` is reused unchanged.
5. ✅ **Orchestration** — `scripts/e2e-devenv.ts` boots the network, starts the
   services with the env vars, runs Playwright, and tears down. (A Playwright
   `globalSetup` couldn't own this — the Rust services must start _after_ the
   network exists and _with_ its env, which a deterministic script handles
   cleanly.)

## Running it

```
npm run test:e2e:devenv
```

Prereqs (same as the normal stack): Postgres running and the `tap` binary on
PATH (`scripts/install-tap.sh`). The orchestrator preflights both. Services run
via `process-compose.devenv.yaml` (species-id dropped — the create/view flow
doesn't need it). Playwright runs `playwright.devenv.config.ts`.

## File map

| File                                   | Role                                                          |
| -------------------------------------- | ------------------------------------------------------------- |
| `network.ts`                           | boot network + seed account + export endpoints/env (reusable) |
| `bootstrap.ts`                         | standalone demo of the live-lexicon + blob path               |
| `../devenv-auth.setup.ts`              | log in via the dev-env PDS OAuth UI                           |
| `../playwright.devenv.config.ts`       | `devenv-setup` → `devenv` (reuses `e2e.spec.ts`)              |
| `../../../scripts/e2e-devenv.ts`       | orchestrator (`npm run test:e2e:devenv`)                      |
| `../../../process-compose.devenv.yaml` | service stack for the run                                     |

## Verified vs. needs a live run

**Verified here:** `network.ts` boots + seeds + writes a real occurrence (run
`bootstrap.ts`); both Playwright projects resolve (`--list`); TS lints + formats
clean.

**Needs a full local run to confirm** (Postgres + `tap` + ~10G disk):

- The end-to-end OAuth handshake against the dev-env PDS. Selectors are pulled
  from `@atproto/oauth-provider-ui` source, but the live login/consent flow (and
  whether the username field is pre-filled from the login hint) is unverified —
  this is the most likely spot to need a tweak.
- `TAP_RELAY_URL` pointed at the PDS firehose: confirm indigo `tap` accepts a
  bare PDS `ws://host` and that the create→firehose→ingester→feed round-trip
  completes inside `e2e.spec.ts`'s budget.

## Caveats

- `@atproto/dev-env` pulls ~1260 transitive packages (incl. `@atproto/pds`,
  `@did-plc/server`). Heavy devDependency; keep it dev-only.
- ATProto's data model forbids floats, so coordinates must be strings / scaled
  ints (the spike learned this the hard way — see `bootstrap.ts`).
