# dev-env e2e

Runs the real e2e flow (`e2e.spec.ts`) against a throwaway local ATProto network
(`@atproto/dev-env`: PLC + PDS + firehose), so test records never reach the
public firehose, production, or any other AppView. This is CI's `e2e` job.

```
npm run test:e2e:devenv
```

Needs Postgres running (`npm run db:up`), plus `psql`, `process-compose` and
`tap` (`scripts/install-tap.sh`) on PATH. Stop the normal dev stack first; the
run uses the same ports and refuses to start if they're taken.

## What a run does

`scripts/e2e-devenv.ts`:

1. Recreates an `observing_devenv` database (your `observing` DB is untouched).
2. Boots the network and creates a fresh `alice.test` account.
3. Starts `process-compose.yaml` + the `process-compose.devenv.yaml` overlay
   (species-id disabled), pointed at the network via the vars below, with a
   temp Tap cursor DB.
4. Registers the account's DID with Tap (`/repos/add`), since Tap only forwards
   repos it tracks.
5. Runs `playwright.devenv.config.ts`: the dev-env login, `e2e.spec.ts`, and the
   mocked `integration` suite.

| Var                   | Points at                                              |
| --------------------- | ------------------------------------------------------ |
| `PLC_DIRECTORY_URL`   | local PLC (appview, identity/blob resolvers, Tap)      |
| `HANDLE_RESOLVER_URL` | PDS `resolveHandle`                                    |
| `TAP_RELAY_URL`       | PDS firehose, `http://` form (Tap does the ws upgrade) |
| `LAG_PROBE_RELAY_URL` | PDS firehose, `ws://` form (tap-ingester's lag probe)  |

All are no-ops in production when unset.

## Notes

- `@atproto/dev-env` (~780 packages) lives in its own `deps/` package with a
  committed lockfile, kept out of the root tree, and is `npm ci`'d on first
  use. To bump it: edit `deps/package.json`, run `npm install --package-lock-only`
  in `deps/`, commit both.
- `npx tsx frontend/tests/dev-env/bootstrap.ts [--serve]` boots the network on
  its own and writes a sample record, for poking at it by hand.
- Tap logging `crawler: ... HTTP 401 AuthMissing` is expected: a bare PDS has no
  relay-enumeration API, and the run registers the DID explicitly instead.
