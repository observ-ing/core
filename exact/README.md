# observ.ing in Exact

observ.ing rebuilt in [Exact](https://github.com/expo/exact), Expo's
cross-platform runtime (Contract views, TypeScript data, native
UIKit/AppKit/Android/Linux hosts, a small DOM runtime on the web). Its web
build is served at https://exact.observ.ing, beside the existing frontend,
against the same appview.

- **Explore**: the feed, paged by the appview's cursor, with filters (kingdom,
  dates, data-quality criteria, a taxon from its page's Show in Explore).
- **Observation**: photos (full size in a sheet), names linking to the taxon,
  data quality, facts, a map (`@exact/maps`: MapKit on Apple, OpenStreetMap
  tiles on the web), identifications, comments, remarks, links elsewhere.
- **Profile**: counts and the person's observations.
- **Taxon**: picture, names, conservation status, classification, description,
  what it includes, its observations, pictures, GBIF and Wikidata.
- **Search**: taxa by name.
- **Signed in**: like and unlike, comment, suggest an identification from a
  taxon search or agree with the one shown (and withdraw your own), delete
  your own observation after a confirmation, a Notifications tab (unread
  marks, mark all read), and the default license for new observations. Signed
  out, each of these opens Account. In tests `server.ts` keeps the fake
  person's writes in memory and lets them own one recorded observation
  (`OWN`) so deleting can be tested.
- **New observation** (+ in Explore and Home): photos from a file picker, with
  previews; the first photo's EXIF fills in the day, time and place (`exif.ts`,
  no dependency; HEIC goes through the appview's `/api/media/heic-to-jpeg`);
  species suggestions from the appview's model (`/api/species-id`) or a taxon
  search, or a name as typed with its kingdom and rank; a last day, for one
  seen over several days; the time zone (the photo's EXIF offset, else this
  device's); a map pin you can move, Use My Location (`@exact/geolocation`),
  or a pin placed on a world map; how many (individuals or percent cover);
  notes; links to the same sighting on other sites; the license, defaulting to
  your preference. Photos are shrunk to the person's server's upload limit
  (`storage.fs.compressImage`) and sent as JPEGs. It's a pushed screen, not a
  sheet: Exact's web sheet grows with its content instead of scrolling.
  `tools/make-exif-fixture.ts` writes the EXIF test photo.
- **Batch upload** (Home): many photos, one observation each, dated and placed
  from EXIF; one tap takes the model's guess per photo; photos without GPS can
  go at your location. **Uploads queue on the device** (`queue.ts`:
  `app:/data/queue.json` and the shrunk JPEGs beside it), so they survive
  going offline and relaunching; Home shows what's waiting, sends it every 20
  s and on Upload Now, and lets a refused one be retried or discarded.
- **Live ID** (Home): the camera (`@exact/media-capture`, `@exact/camera`)
  takes a frame every 4 s for the appview's fast model; Use starts a new
  observation from that frame and species. Exact's test driver holds the
  camera as a device prompt a test can't answer, so only its way in is tested.
- **iNaturalist** (Account, when the appview cross-posts): link an account in
  the system browser (the appview hands the answer back and this session
  finishes it at `POST /api/inat/link`), unlink after asking, and the
  cross-post preferences; "Also post to iNaturalist" on New Observation and
  Batch Upload (your preference until changed); on your own observations, its
  cross-post status, View on iNaturalist, and Post (or Try Again).
- **Polish**: observ.ing's green as the accent (`app.forma`); a welcome card
  at the top of Explore on a signed-out first visit (Sign In or Just Browse,
  remembered); an offline banner with Try Again; a profile's Identifications
  beside its Observations. Its routes are observ.ing's own
  (`/observation/:did/:rkey`, `/profile/:did`, `/taxon/:kingdom/:name`), so
  observ.ing links open the same screens; on iOS, `applinks:observ.ing` is
  declared, which needs observ.ing to serve an apple-app-site-association
  naming the app.
- **Sign in** (Account tab) with an atproto handle, and the signed-in **Home**
  feed. The system browser runs the appview's OAuth flow (`GET
  /oauth/app/login`), which redirects back to the app with a one-time code;
  the app trades it with its PKCE verifier for a session token (`POST
  /oauth/app/token`), keeps the token in the platform's secret store, and sends
  it as `Authorization: Bearer` (the appview's opaque sessions, observ-ing/core#1034).
  Sign Out ends the session on the appview. In tests `server.ts` fakes them (one
  person, `naturalist.test`; `decline.test` declines).

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

It builds against the Exact commit in `EXACT_REV`, with the not-yet-landed
fixes in `deploy/exact-patches/`. `deploy/setup-exact.sh` checks that commit
out at `~/src/exact` (or wherever `EXACT` points), applies the patches,
installs what a web build needs and points this app at it:

```sh
exact/deploy/setup-exact.sh            # from the repo root; moves the checkout to EXACT_REV
cd exact
bun exact.mjs web                      # the web dev loop, at http://127.0.0.1:8765/
APPVIEW=https://observ.ing bun server.ts  # live data, in another terminal (omit APPVIEW for fixtures)
bun exact.mjs test                     # stop server.ts first: test starts its own on fixtures/
                                       # (CHROME=<path to Chrome> if Playwright's Chromium isn't installed)
```

To move to a newer Exact, change `EXACT_REV`, drop any patch that has landed,
run `setup-exact.sh`, then `bun exact.mjs verify`.

Sign-in goes to the appview itself (its OAuth client redirects to its own
origin): build with `OBSERVING_AUTH_ORIGIN=<that appview>` to sign in against a
real one; it defaults to `server.ts`. Against a local appview from this branch
(`cargo run -p observing-appview` with `PORT=3100`, `PUBLIC_URL` unset):

```sh
APPVIEW=http://127.0.0.1:3100 bun server.ts
OBSERVING_AUTH_ORIGIN=http://127.0.0.1:3100 bun exact.mjs web
```

Use `127.0.0.1`, not `localhost`: the appview's sign-in cookie and its atproto
callback are both on `127.0.0.1`.

A local appview's database starts empty, so every observation answers 404 until
something fills it: run `cargo run -p tap-ingester` beside it on the same
`DATABASE_URL` (with `PORT=8091 APPVIEW_PORT=3100`, and `tap` on `PATH`). Its
first minute backfills everything posted to observ.ing; what the app posts shows
up a moment later, as on observ.ing.

To read a different appview, set `APPVIEW` (a local one is `http://localhost:3000`). Native hosts send no
cookies, so signed-in endpoints would need token auth.

## Deployed

CI (`exact-deploy`, on every push to main) builds the site for
`https://exact.observ.ing` with `deploy/stage.sh` and deploys it to Cloud Run
as `observing-exact` in the `observ-ing` project: `deploy/site.ts` serving the
static build. The page calls `https://observ.ing` directly and signs in
there, which needs the appview's `CORS_ORIGINS` to name
`https://exact.observ.ing` and its `APP_REDIRECT_URIS` to name
`https://exact.observ.ing/.exact/auth/callback` (both set in `ci.yml`). The
Android and iOS builds sign in at the same appview and get the code back at
`ing.observ.exact:/oauth`, which `APP_REDIRECT_URIS` names too.

`PROJECT=<project> WEB_ORIGIN=<url> deploy/deploy.sh` deploys a build by hand,
for example a preview in another project; that origin needs the same two
appview settings.
