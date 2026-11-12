# Exact spike: observ.ing, signed out

observ.ing rebuilt in [Exact](https://github.com/expo/exact), Expo's
cross-platform runtime (Contract views, TypeScript data, native
UIKit/AppKit/Linux hosts, a small DOM runtime on the web): everything a
signed-out visitor can browse.

- **Explore**: the feed, paged by the appview's cursor, with filters (kingdom,
  dates, data-quality criteria, a taxon from its page's Show in Explore).
- **Observation**: photos (full size in a sheet), names linking to the taxon,
  data quality, facts, a map (`@exact/maps`: MapKit on Apple, OpenStreetMap
  tiles on the web), identifications, comments, remarks, links elsewhere.
- **Profile**: counts and the person's observations.
- **Taxon**: picture, names, conservation status, classification, description,
  what it includes, its observations, pictures, GBIF and Wikidata.
- **Search**: taxa by name.
- **Sign in** (Account tab) with an atproto handle, and the signed-in **Home**
  feed. The system browser runs the appview's OAuth flow (`GET
  /oauth/app/login`), which redirects back to the app with a one-time code;
  the app trades it with its PKCE verifier for a session token (`POST
  /oauth/app/token`), keeps the token in the platform's secret store, and sends
  it as `Authorization: Bearer` (the appview's opaque sessions, observ-ing/core#1034).
  Sign Out ends the session on the appview. **The appview doesn't serve
  `/oauth/app/*` yet**: `server.ts` fakes them (one person, `naturalist.test`;
  `decline.test` declines) for the tests.

Files:

- `app.contract`: the views. `app.ts`: the data module, one source per screen,
  each answering a flattened shape of the appview's JSON.
- `server.ts`: the dev server `app.ts` reads. With `APPVIEW=<origin>` it proxies
  `/api/*` and `/media/*` to that appview (no appview has to allow Exact's dev
  origin); without it, it answers from `fixtures/`, swapping each photo for a
  placeholder PNG in `assets/photos` (Exact's Linux host has no JPEG decoder).
- `fixtures/api.json`: real appview responses, recorded verbatim by `bun
  record.ts [origin]` (default https://observ.ing) and filed by `fixture-key.ts`.
- `bindings/`: the appview's ts-rs types, copied from `frontend/src/bindings` by
  `bun sync-bindings.ts` (`--check` fails when stale): an Exact build reads only
  files inside this directory.
- `app.test.contract`: tests against the recorded fixtures.

## Running it

It needs an Exact checkout, found at `../../expo/exact` relative to this
directory, or wherever `EXACT2` points:

```sh
git clone https://github.com/expo/exact ~/src/exact
export EXACT2=~/src/exact
bun exact.mjs web                      # the web dev loop, at http://127.0.0.1:8765/
APPVIEW=https://observ.ing bun server.ts  # live data, in another terminal (omit APPVIEW for fixtures)
bun exact.mjs test                     # stop server.ts first: test starts its own on fixtures/
                                       # (CHROME=<path to Chrome> if Playwright's Chromium isn't installed)
```

Sign-in goes to the appview itself (its OAuth client redirects to its own
origin): build with `OBSERVING_AUTH_ORIGIN=<that appview>` to sign in against a
real one; it defaults to `server.ts`.

To read a different appview, set `APPVIEW` (a local one is `http://localhost:3000`). Native hosts send no
cookies, so signed-in endpoints would need token auth.
