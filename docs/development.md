# Development

## Prerequisites

- Node.js 24+ (matches `engines.node` in `package.json` and the version CI runs)
- Rust (pinned to the channel in `rust-toolchain.toml`; `rustup` will pick it up automatically)
- PostgreSQL (14+) with the PostGIS extension — production runs 16, but any modern version works locally
- [`process-compose`](https://github.com/F1bonacc1/process-compose) to orchestrate the dev stack
- ONNX Runtime, for the `species-id` service:
  - macOS: `brew install onnxruntime`
  - Linux: install via your distro (`libonnxruntime` / `onnxruntime-dev`)
- Go 1.26+, only if you plan to build the upstream `tap` binary locally (see [Tap binary](#tap-binary) below)

> First-time setup downloads ~1.4 GB of BioCLIP models and compiles the full Rust workspace.
> Expect 20–40 minutes on a warm laptop.

On macOS, `brew bundle` installs every prerequisite listed above from
the project's `Brewfile`. asdf/mise users get Node and Go from
`.tool-versions`.

## Scripted setup (recommended)

```bash
cp .env.example .env       # tweak DATABASE_URL / DB_PASSWORD to match your Postgres
npm run setup              # bootstraps everything below in one shot
# ensure Postgres is running (see Database Setup below)
process-compose up -D      # runs migrations, then starts services
```

`npm run setup` is idempotent — re-run any time, and it skips work
that's already done. It runs:

1. Prerequisite check (Node 24+, Rust, process-compose)
2. `npm install`
3. `./scripts/install-tap.sh` — pinned `tap` Go binary, if not on PATH
4. `./scripts/download-models.sh` — BioCLIP models, if not present

Postgres lifecycle is left to you (it's stateful and often shared
with other projects). Migrations are run automatically by
`process-compose up` as the first process — see
[Running services](#running-services).

To diagnose problems without changing anything:

```bash
npm run doctor             # read-only; prints pass/fail for every check
```

The rest of this document covers each step in detail for when you need
to run them by hand.

## Installation

```bash
npm install
```

## Database Setup

Run PostgreSQL with PostGIS locally. All app services connect over
`localhost:5432` — there is no Cloud SQL Proxy step in local dev;
production Cloud SQL is a separate concern handled by CI (see
`docs/deployment.md`).

Docker is the path of least resistance:

```bash
# One-time: create the container
docker run --name observing-postgres \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -e POSTGRES_DB=observing \
  -p 5432:5432 \
  -d postgis/postgis

# After reboot / on subsequent sessions
docker start observing-postgres
```

Native installs (Postgres.app, Homebrew `postgresql@N` + `postgis`,
etc.) work too — anything that exposes PostgreSQL with PostGIS on
`localhost:5432` is fine.

## Configuration

All environment variables the stack reads are listed and explained in
[`.env.example`](../.env.example) at the project root. Copy it once and
edit as needed:

```bash
cp .env.example .env
```

`.env` is gitignored. `process-compose up` reads it automatically when
started from this directory. For other shells (running `cargo run -p …`
directly, running tests by hand, etc.) source it:

```bash
set -a && source .env && set +a
```

The only var that's required for the basic stack to come up is
`DATABASE_URL` (or the `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` quad).
`BLUESKY_TEST_*` are only needed for `npm run test:e2e`.

## Models (species-id)

The `species-id` service loads BioCLIP ONNX models from `MODEL_DIR`
(default `./models/bioclip`, ~1.4 GB). Download them once:

```bash
./scripts/download-models.sh
```

The `models/` directory is gitignored. Re-run the script after a
checkout on a new machine, or whenever model versions are bumped.

## Tap binary

`tap-ingester` spawns the upstream [`tap`](https://github.com/bluesky-social/indigo/tree/main/cmd/tap)
Go binary as a child process. It must be on `PATH` (or in the working
directory) when `cargo run -p tap-ingester` starts.

Install it once, pinned to the same revision the production Dockerfile
and CI use:

```bash
# Same indigo commit CI builds against (see .github/workflows/ci.yml).
INDIGO_REV=ce62b8fce9e01434213a69cb251852b2c9436cb9
GODEBUG=netdns=go go install \
  github.com/bluesky-social/indigo/cmd/tap@$INDIGO_REV
```

This drops `tap` into `$(go env GOPATH)/bin`; make sure that directory
is on your `PATH`.

## Running Migrations

Migrations are versioned files under `crates/observing-db/migrations/`
and applied by `sqlx`. `process-compose up` runs them automatically as
a one-shot `migrate` process that blocks `appview` and `tap-ingester`
from starting until the schema is current — so for the default path,
you don't have to do anything here.

For the standalone case (running services directly via `cargo run -p`,
or iterating on migration files), apply them by hand:

```bash
# Run the same binary CI uses for the Cloud Run Job
cargo run -p observing-migrate

# Or, via sqlx-cli (useful when iterating on migration files — reads
# filesystem at runtime instead of baking migrations in at compile time)
cargo sqlx migrate run --source crates/observing-db/migrations
```

In production, migrations run in a one-shot `observing-migrate` Cloud Run Job *before* services are deployed — long-running services never run DDL. See `docs/deployment.md`.

### Seed Data

`frontend/tests/seed.sql` inserts a handful of observation records under the e2e
test DID. CI loads it after migrations so e2e specs have something to
render against; locally it's optional but useful when poking around the
explore feed:

```bash
psql "$DATABASE_URL" -f frontend/tests/seed.sql
```

Safe to re-run only after wiping the relevant rows — it does plain
`INSERT`s, not upserts.

## Common Commands

```bash
# Install dependencies
npm install

# Build static frontend (will be served instead of hot-reloading Vite content)
npm run build

# Typecheck frontend
npx tsc

# Format frontend (oxfmt, not Prettier)
npm run fmt
npm run fmt:check

# Lint frontend (oxlint)
npm run lint

# Build Rust workspace
cargo build

# Format Rust
cargo fmt

# Run Rust tests
cargo test --workspace

# Generate lexicon types (Rust)
npm run generate-rust-types
```

## Running Services

### Using process-compose (recommended)

With Postgres running on `localhost:5432`, `process-compose up` runs
the one-shot `migrate` process to apply any pending DB migrations,
then brings up `species-id`, `appview`, `tap-ingester`, and `frontend`
in their declared dependency order. Config lives in `process-compose.yaml`.

```bash
# Start all services (detached)
process-compose up -D

# View processes
process-compose process list

# Stop/start individual services
process-compose process stop <name>
process-compose process start <name>

# Restart after changes
process-compose process restart appview

# View logs
process-compose process logs <name>

# Stop all
process-compose down
```

Process names: `migrate`, `species-id`, `appview`, `tap-ingester`,
`frontend` (in startup order).

#### Running several checkouts at once (randomized ports)

The four services default to fixed ports (`appview` 3000, `species-id`
3005, `frontend`/Vite 5173, `tap-ingester` 8080), so two checkouts that
both run `process-compose up` collide. To run them in parallel, start the
stack through the wrapper instead:

```bash
npm run dev:stack        # or: ./scripts/dev.sh
```

It picks one random offset, applies it uniformly to every service, exports
the derived ports, and prints where each one landed (including the
`http://127.0.0.1:<appview>` front door to open). Cross-service URLs — the
Vite `/api` proxy, the appview→Vite dev proxy, `SPECIES_ID_SERVICE_URL` —
all follow the offset automatically. Postgres is left on `5432`; it lives
outside process-compose and is meant to be shared.

Pin the offset when you want stable, reproducible ports for a checkout:

```bash
DEV_PORT_OFFSET=2000 npm run dev:stack   # appview 5000, vite 7173, ...
DEV_PORT_OFFSET=0 npm run dev:stack      # stock ports, no randomization
```

Plain `process-compose up` still works and keeps the stock ports — the
ports are all `${VAR:-default}` overrides, and the wrapper just sets those
vars.

### Individual Services

```bash
# AppView (REST API + OAuth + media cache + GBIF taxonomy + static files on port 3000)
cargo run -p observing-appview

# Tap-ingester (firehose consumer; spawns the upstream `tap` binary,
# which must be on PATH or in the working directory)
cargo run -p tap-ingester

# Frontend dev server (serves frontend if `npm run build` hasn't been run)
npm run dev
```

## Frontend: dev mode vs static build

The frontend runs in **one of two modes**, and which one you're in is
determined entirely by whether `dist/public/` has files in it. Both modes
serve the app at `http://localhost:3000` (not `:5173`) — appview is
always the front door.

| Mode | When | Behavior |
|---|---|---|
| **Dev (Vite proxy)** | `dist/public/` is empty | Appview proxies frontend requests to the Vite dev server, which is hot-reloading frontend source. The `frontend` process must be running. This is what you want for day-to-day frontend work. |
| **Static (prod-like)** | `dist/public/` has files | Appview serves the built bundle directly. Useful for reproducing production behavior, performance tests, or working on backend code without keeping Vite running. |

**Switch to dev mode** by deleting the built bundle:

```bash
rm -rf dist/public && process-compose process restart appview
```

**Switch to static (prod-like) mode** by rebuilding:

```bash
npm run build && process-compose process restart appview
```

If you change frontend code while in static mode, your edits won't show
up until you rebuild — a common "why isn't my change appearing?" gotcha.

## Tests

Backend tests with `cargo test --workspace` should run without setup.

Frontend integration tests require the full stack to run:

```sh
# Start full development stack
process-compose up -D

# Run the tests
npm run test:integration
```

E2E tests (`npm run test:e2e`) are truly end-to-end — they sign in to a real Bluesky account, so they require a full stack and these credentials in the environment: `BLUESKY_TEST_EMAIL`, `BLUESKY_TEST_PASSWORD`, `BLUESKY_TEST_HANDLE`.

```sh
# Start full development stack
process-compose up -D

# Source credentials from .env
set -a && source .env && set +a

# Run the tests
npm run test:e2e
```
