# CI

Why the jobs in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) are set up the way they are. Every job runs on pull requests, the merge queue and pushes to `main`; the image build and deploy jobs run only on push. For the deploy steps' flags and sizing, see [infra/README.md](../infra/README.md); for their order, [docs/deployment.md](deployment.md#deploy-order).

## Frontend

- **`ts-typecheck`** also typechecks `frontend/tests/tsconfig.json`. The Playwright specs build API fixtures typed against the generated bindings but live outside the app's tsconfig. Without this, a fixture that no longer matches its type only shows up as a wall of failing e2e tests half an hour later.
- **`integration`** is the mocked Playwright suite. It needs no backend: `playwright.config.ts`'s `webServer` builds the SPA and serves it with every backend route answering 404, and each spec mocks what it uses with `page.route`. So it runs on its own, in parallel, instead of behind the dev-env stack the `e2e` job boots.
- **`android-build`** is a spike: it wraps the web bundle in a Capacitor shell and assembles a debug APK, to check that `npm run build` output drops into a native target without touching web code. `android/` is gitignored and regenerated each run with `npx cap add android`. It builds with `VITE_API_URL=https://observ.ing`, as the release workflow does, so the APK has the bundle users would get from a tagged release. See #273, #388, #403.

## Storybook

- **`storybook-coverage`** checks that every component in `frontend/src/components` has a sibling `*.stories.tsx`, and that no story adds its own router on top of the global one.
- **`storybook-test`** mounts every story in headless Chromium (Vitest browser mode, `@storybook/addon-vitest`). `storybook-build` only proves stories compile; this catches the ones that throw at render time.
- **`storybook-build`** runs on every PR so a broken story fails the merge gate. On push it uploads the static output for `storybook-deploy`.
- **`storybook-deploy`** puts that output in a static-web-server image and deploys it to Cloud Run. Why Cloud Run: [infra/README.md#storybook](../infra/README.md#storybook).

## Rust

- **`rust-sqlx`** needs a live Postgres: sqlx-cli 0.9's `prepare --check` dropped the offline mode 0.8 had. The job runs migrations first, which also set the database's `search_path` (`ingester, appview, public`) so the unqualified table names in the query macros resolve.
- **sqlx-cli is pinned to 0.9.0.** It needs rustc 1.94 or later, which the `rust-toolchain.toml` pin satisfies, and it matches the workspace's sqlx 0.9. Bump it in step with the toolchain pin.
- **`rust-db-test`** runs `crates/observing-db/tests`. Each test creates, migrates and drops its own scratch database on the job's Postgres.

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
