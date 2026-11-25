# CI

Why the jobs in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) are set up the way they are. Every job runs on pull requests, the merge queue and pushes to `main`; the image build and deploy jobs run only on push. For the deploy steps' flags and sizing, see [infra/README.md](../infra/README.md); for their order, [docs/deployment.md](deployment.md#deploy-order).

## Frontend

- **`ts-bindings-check`** regenerates the ts-rs bindings from both crates that export them (`observing-appview` and `observing-species-id-protocol`) and fails on any change under `frontend/src/bindings`, including a new type's file that was never committed (`git diff` alone misses untracked files). It also runs `exact/sync.ts --check`, so the Exact app's copy in `exact/bindings` has to match. `exact-test` checks that copy as well, but it isn't a required check, and #1091 merged with it failing. `npm run bindings` regenerates both.
- **`ts-typecheck`** also typechecks `frontend/tests/tsconfig.json`. The Playwright specs build API fixtures typed against the generated bindings but live outside the app's tsconfig. Without this, a fixture that no longer matches its type only shows up as a wall of failing e2e tests half an hour later.
- **`integration`** is the mocked Playwright suite. It needs no backend: `playwright.config.ts`'s `webServer` builds the SPA and serves it with every backend route answering 404, and each spec mocks what it uses with `page.route`. So it runs on its own, in parallel, instead of behind the dev-env stack the `e2e` job boots.
- **`android-build`** is a spike: it wraps the web bundle in a Capacitor shell and assembles a debug APK, to check that `npm run build` output drops into a native target without touching web code. `android/` is gitignored and regenerated each run with `npx cap add android`. It builds with `VITE_API_URL=https://observ.ing`, as the release workflow does, so the APK has the bundle users would get from a tagged release. See #273, #388, #403.

## Storybook

- **`storybook-coverage`** checks that every component in `frontend/src/components` has a sibling `*.stories.tsx`, and that no story adds its own router on top of the global one.
- **`storybook-test`** mounts every story in headless Chromium (Vitest browser mode, `@storybook/addon-vitest`). `storybook-build` only proves stories compile; this catches the ones that throw at render time.
- **`storybook-build`** runs on every PR so a broken story fails the merge gate. On push it uploads the static output for `storybook-deploy`.
- **`storybook-deploy`** puts that output in a static-web-server image and deploys it to Cloud Run. Why Cloud Run: [infra/README.md#storybook](../infra/README.md#storybook).

## Exact app

- **`exact-test`** runs the Exact app's tests (`exact/app.test.contract`) in headless Chromium against `exact/server.ts`, which answers from recorded fixtures, so no appview is involved. `exact/deploy/setup-exact.sh` first checks out Exact at `exact/EXACT_REV`, applies `exact/deploy/exact-patches/` (fixes reported upstream but not yet landed) and installs Exact's pinned Rust, wasm-bindgen, Binaryen and Chromium. The cache is keyed on the pin and the patches, so moving the pin starts it cold.
- **`exact-android`** builds the Exact app's release APK and uploads it as the `exact-android-apk` artifact (kept 14 days). `setup-exact.sh android` adds the `aarch64-linux-android` Rust target and Hermes bundle; the SDK packages (platform 37.2, build-tools 37.0.0, NDK 27.1.12297006) are the ones Exact's `host/android` names, so bump them when the pin moves and `setup --check --platform android` fails. It points at `https://observ.ing`, like the site. A release build refuses to start without the Google Maps key variable `exact/app.json` names (`OBSERVING_MAPS_ANDROID_KEY`); the job reads it from the `MAPS_ANDROID_KEY` secret and falls back to a placeholder, which builds but leaves the map blank. The APK is signed with the runner's freshly made debug key, so each run's APK has a different signature: uninstall the last one before installing the next, and a Maps key restricted to a signing certificate won't match. Nothing installs or publishes it; a Play upload would need an upload keystore (`EXACT_KEYSTORE` and friends) and `--bundle`.
- **`exact-ios`** builds the Exact app as a release iOS Simulator app and uploads it zipped as the `exact-ios-simulator-app` artifact (kept 14 days). Unzip it and drag the `.app` onto a booted simulator, or `xcrun simctl install booted <app>`. Exact's Swift host needs Xcode 27.1 or later, which GitHub has only on the public-preview `xcode-27` image so far; move to a standard `macos-*` label once one carries it. `setup-exact.sh ios` adds the `aarch64-apple-ios-sim` Rust target and Hermes bundle. No signing or Apple account is involved, so the app runs only in the simulator; `exact/app.json` sets `deploy.store.ios` to `"0"` (no over-the-air updates), which a release build requires. A phone or TestFlight build would need a team's certificate and provisioning profile as secrets.
- **`exact-publish`** (pushes to main only, after `exact-android` and `exact-ios`) uploads both builds to the `exact-latest` prerelease as `observing-exact.apk` and `observing-exact-sim.zip`, replacing the last ones and moving the tag to this commit. It's marked not-latest, so the `v*` releases stay the repository's latest. Their `releases/download/exact-latest/…` URLs don't change, and the site's Account tab links to them (`DOWNLOADS` in `exact/deploy/stage.sh`). Until a push has published, the links 404.
- **`exact-deploy`** builds the site for `https://exact.observ.ing` (`exact/deploy/stage.sh`) and deploys it as the `observing-exact` service. It waits only for `exact-test`: the site calls the deployed appview, so it doesn't need this push's appview first.

## Rust

- **`rust-sqlx`** needs a live Postgres: sqlx-cli 0.9's `prepare --check` dropped the offline mode 0.8 had. The job runs migrations first, which also set the database's `search_path` (`ingester, appview, public`) so the unqualified table names in the query macros resolve.
- **sqlx-cli is pinned to 0.9.0.** It needs rustc 1.94 or later, which the `rust-toolchain.toml` pin satisfies, and it matches the workspace's sqlx 0.9. Bump it in step with the toolchain pin.
- **`rust-db-test`** runs `crates/observing-db/tests`. Each test creates, migrates and drops its own scratch database on the job's Postgres.
- **`lexicons-lint`** runs [goat](https://github.com/bluesky-social/goat)'s `goat lex lint` over `lexicons/`. It checks schema syntax and atproto best practices (missing descriptions, invalid NSIDs, unknown fields) before `rust-lexicons-check` turns the schemas into Rust types. Warnings fail the job as well as errors. It downloads a pinned, checksummed release binary rather than `go install`, which would need Go 1.27. To bump it, update `GOAT_VERSION` and `GOAT_SHA256` from the release's `checksums.txt`. Run it locally with `goat lex lint lexicons/` (`brew install goat`).

## e2e

Boots a local `@atproto/dev-env` network (PLC, PDS, firehose), points the Rust stack at it (`process-compose.yaml` plus the `process-compose.devenv.yaml` overlay) and runs the dev-env CRUD specs (`playwright.devenv.config.ts`). No test data reaches the public network, so no `BLUESKY_*` credentials are needed. The orchestrator (`scripts/e2e-devenv.ts`) inherits stdio, so service logs stream to the job output on failure.

- **Database.** The orchestrator recreates its own `observing_devenv` database (and a temporary Tap cursor database) on the job's Postgres each run.
- **Prebuilt frontend.** With `dist/public` present, the appview serves the static bundle instead of proxying to Vite. Under CI load a cold Vite compile on the first navigation raced auth-setup's 30 s timeout. process-compose still starts Vite, which the appview then ignores.
- **Prebuilt binaries.** `migrate`, `appview` and `tap-ingester` are built before the stack starts, so `cargo run` in process-compose comes up well within its readiness probes. Migrations run inside the stack (the `migrate` process); there's no separate sqlx step. The devenv overlay disables species-id.
- **Upstream `tap`.** `INDIGO_REV` is the same indigo commit `infra/docker/Dockerfile` pins. Building tap takes about 70 s and the commit rarely changes, so the binary itself is cached, keyed on the commit and Go version. setup-go's own cache can't help: it keys on a `go.sum`, and this repo has none.
- **Record validation.** After Playwright, the orchestrator replays the dev-env PDS firehose from cursor 0 with `goat firehose --ops` and runs `goat lex validate` against `lexicons/` on every `bio.lexicons.*` and `ing.observ.*` record the run created or updated. Nothing else checks those records: the appview writes with `validate` unset, and a PDS skips schemas it doesn't know (`validationStatus: "unknown"`). The firehose rather than the repo, because the specs delete their records as they go. It runs even when Playwright fails, and a run that wrote no such records fails too. goat is a pinned, checksummed release binary (`GOAT_VERSION`, `GOAT_SHA256`); to bump it, update both from the release's `checksums.txt`.
- **dev-env dependencies.** The harness `npm ci`s its own lockfile (`frontend/tests/dev-env/deps`) on demand; see `frontend/tests/dev-env/network.ts`. Caching its `node_modules`, including the install stamp `network.ts` checks, skips that ~780-package install. The key includes the exact Node version, since better-sqlite3 builds a native addon.

## build-images

Builds and pushes every image in one BuildKit session (`infra/docker/docker-bake.hcl`). The Rust images share one compiled build, so a Rust change pulls the toolchain and dependency layers from the registry cache once, not once per image; each pull is Artifact Registry internet egress.

- **Registry cache only, no `type=gha`.** Exporting to the GHA cache made BuildKit download every layer it held only as a lazy registry reference, and image layers overflow the 10 GB GHA cache.
- **Free disk space.** One runner holds every image, including both species-id model bundles on the rare push that rebuilds their layers, so the job deletes two large preinstalled toolchains (CodeQL, .NET) it never uses.
- **`VITE_MAPTILER_KEY`** is used only by the appview's frontend build and must be a key allowed for `https://observ.ing`. Unset, the map falls back to keyless CARTO tiles.

## deploy

Each step's flags are explained in the matching section of [infra/README.md](../infra/README.md).

- **One deploy at a time** (`concurrency: deploy-production`, not cancelled in progress). Cloud Run rejects a service update when another lands mid-deploy ("Conflict for resource ... version ... was specified"), so production deploys queue instead of running side by side.
- **`INGESTER_URL`** is tap-ingester's custom domain; the appview reads its `/api/stats` and `/api/tap-stats` for the `ingester/*` admin tables.
