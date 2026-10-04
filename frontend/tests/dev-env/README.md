# dev-env e2e isolation

Goal: run the "live lexicon + blob" e2e path against a **throwaway local ATProto
network** so test records never reach the public firehose — and therefore never
appear on our production site **or any other AppView**. This is the only approach
that fully satisfies "no other AppView picks up the DID" (DID-denylisting at our
own ingester only cleans _our_ view; the records still federate).

## Status: green end to end

`npm run test:e2e:devenv` runs the full create→firehose→ingester→DB round-trip
against a local `@atproto/dev-env` network and passes, touching no public
network. This is the CI `e2e` job — it needs no `BLUESKY_*` credentials.

`bootstrap.ts` boots `@atproto/dev-env`'s `TestNetworkNoAppView` (PLC + PDS +
firehose, random ports), creates a real account, uploads a blob, and writes a
real `bio.lexicons.temp.v0-1.occurrence` record. Run it for manual inspection:

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
  "account": { "did": "did:plc:...", "handle": "alice.test", "password": "e2e-test-pw" },
  "occurrenceUri": "at://did:plc:.../bio.lexicons.temp.v0-1.occurrence/spike1"
}
```

## Pointing the Rust stack at the local network

dev-env hands us a PLC URL and a PDS URL (which serves both `resolveHandle` and,
like a relay, `subscribeRepos`). These env vars redirect the stack at them (all
no-op in production when unset). `devEnvVars()` in `network.ts` sets them from the
booted network; the orchestrator passes them to process-compose, which hands
its environment to every service.

| Var                   | Effect                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PLC_DIRECTORY_URL`   | did:plc resolution in appview OAuth, identity resolver, and blob resolver                                  |
| `HANDLE_RESOLVER_URL` | handle→DID via `resolveHandle` against this URL instead of DNS/well-known (PDS URL)                        |
| `TAP_RELAY_URL`       | firehose Tap subscribes to — the PDS's `subscribeRepos`. Must be **`http://`** (Tap upgrades to ws itself) |
| `LAG_PROBE_RELAY_URL` | same firehose in **`ws://`** form, for tap-ingester's heartbeat lag probe (tokio_tungstenite)              |

Two details the round-trip depends on, handled for you:

- **PLC scheme.** For Tap, tap-ingester sets the go binary's `TAP_PLC_URL`
  directly (trailing-slash-trimmed) rather than via `tapped`'s `plc_url(Url)`,
  whose `Url::to_string()` would append a slash and make indigo build
  `{plc}//{did}` → PLC 404. See the override block in `tap-ingester/src/main.rs`.
- **DID registration.** Tap only forwards repos it tracks, and an occurrence
  record has no subject for tap-ingester's cross-repo resolver to latch onto — so
  the orchestrator POSTs the test DID to Tap's `/repos/add` admin endpoint after
  the firehose channel connects. The account is fresh each run, so backfill is
  trivial.

## Running it

```
npm run test:e2e:devenv
```

Prereqs (same as the normal stack): Postgres running, plus `psql` and the `tap`
binary on PATH (`scripts/install-tap.sh`). The orchestrator preflights them.
Services run from `process-compose.yaml` with the `process-compose.devenv.yaml`
overlay on top (species-id disabled — the create/view flow doesn't need it).
Playwright runs `playwright.devenv.config.ts`, which covers the mocked
`integration` suite plus the dev-env CRUD `e2e` flow in one pass.

Each run is isolated from your dev stack and from previous runs:

- **Postgres:** the orchestrator drops and recreates an `observing_devenv`
  database on the server named by `DATABASE_URL` (or `.env`), and the stack's
  `migrate` process applies the schema to it. Your `observing` database is never
  touched. The database is left in place after the run for inspection.
- **Tap:** its sqlite cursor DB lives in a fresh temp dir, removed afterwards.
  Each run's PDS restarts its firehose sequence near 0, so a persisted cursor
  would sit ahead of the new head and Tap would miss the run's commits.
- **`.env`:** process-compose is started with `--disable-dotenv`, since `.env`
  values would otherwise override the orchestrator's environment (e.g. point
  `DATABASE_URL` back at the dev database).

`@atproto/dev-env` is **not** a root dependency. It lives in its own package,
`deps/` (committed `package.json` + `package-lock.json`), which the first run
installs on demand with `npm ci` and imports from (see `ensureDevEnv` in
`network.ts`). Later runs reuse the install until the lockfile changes; a stamp
written after a successful `npm ci` catches both lockfile bumps and interrupted
installs. This keeps its ~780 transitive packages out of the root lockfile, so
normal `npm ci` for devs and CI stays unaffected, while the dev-env tree is
still fully locked. CI caches `deps/node_modules` keyed on that lockfile.

## File map

| File                                   | Role                                                               |
| -------------------------------------- | ------------------------------------------------------------------ |
| `network.ts`                           | boot network + seed account + export endpoints/env (reusable)      |
| `deps/`                                | pinned `@atproto/dev-env` package + lockfile (installed on demand) |
| `bootstrap.ts`                         | standalone demo of the live-lexicon + blob path                    |
| `../devenv-auth.setup.ts`              | log in via the dev-env PDS OAuth UI                                |
| `../playwright.devenv.config.ts`       | `devenv-setup` → `devenv` + `integration` (reuses `e2e.spec.ts`)   |
| `../../../scripts/e2e-devenv.ts`       | orchestrator (`npm run test:e2e:devenv`)                           |
| `../../../process-compose.devenv.yaml` | overlay on `process-compose.yaml` for the run                      |

## Notes

- `@atproto/dev-env` pulls ~780 transitive packages (incl. `@atproto/pds`,
  `@did-plc/server`). To change the pinned version, edit `deps/package.json`
  and run `npm install --package-lock-only` in `deps/`, then commit both.
- The dev-env PDS binds to `http://localhost:<random-port>` (not `127.0.0.1`),
  while the app is served at `127.0.0.1:3000`. The OAuth setup waits for the
  browser to leave the app origin, not for a non-localhost host.
- ATProto's data model forbids floats, so coordinates must be strings / scaled
  ints (see `bootstrap.ts`).
- Tap's `crawler: failed to enumerate network: HTTP 401 AuthMissing` in the logs
  is benign — a bare PDS has no relay-enumeration API, but the flow doesn't need
  it (the DID is registered explicitly via `/repos/add`).
