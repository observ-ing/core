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

## Pointing the Rust stack at the local network

dev-env hands us a PLC URL, a PDS URL, and a firehose URL. Three env vars now
redirect the stack at them (all no-op in production when unset):

| Var | Effect |
| --- | --- |
| `PLC_DIRECTORY_URL` | did:plc resolution in appview OAuth, identity resolver, blob resolver, **and** Tap |
| `HANDLE_RESOLVER_URL` | handle→DID via `resolveHandle` against this URL instead of DNS/well-known (appview OAuth + identity resolver) |
| `TAP_RELAY_URL` | upstream firehose Tap subscribes to — a relay or a single PDS's `subscribeRepos` |

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

### Still open

4. **OAuth login UI** — `frontend/tests/auth.setup.ts` drives **bsky.social's**
   HTML (password field, "Authorize" button). The dev-env PDS serves the
   `@atproto/pds` OAuth UI, which has different markup, so the setup selectors
   must be rewritten — or bypass OAuth by injecting a session row directly.
5. **Playwright `globalSetup`** — boot `bootstrap.ts`, export the three env vars
   to the services, and tear down in `globalTeardown`.

## Caveats

- `@atproto/dev-env` pulls ~1260 transitive packages (incl. `@atproto/pds`,
  `@did-plc/server`). Heavy devDependency; keep it dev-only.
- ATProto's data model forbids floats, so coordinates must be strings / scaled
  ints (the spike learned this the hard way — see `bootstrap.ts`).
