# Development

## Prerequisites

- Node.js 20+ (for frontend build)
- PostgreSQL with PostGIS extension
- Rust

## Installation

```bash
npm install
```

## Database Setup

```bash
# Using Docker with PostGIS
docker run --name observing-postgres \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -p 5432:5432 \
  -d postgis/postgis

# Create database
docker exec -it observing-postgres createdb -U postgres observing
```

## Configuration

Most developer commands read `DATABASE_URL` from the environment:

```bash
export DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/observing"
export PORT=3000
```

Secrets for e2e and `process-compose` live in a gitignored `.env` at the project root. Source it once per shell:

```bash
set -a && source .env && set +a
```

## Running Migrations

Migrations are versioned files under `crates/observing-db/migrations/` and applied by `sqlx`. Locally you can run them either of these ways:

```bash
# Run the same binary CI uses for the Cloud Run Job
cargo run -p observing-migrate

# Or, via sqlx-cli (useful when iterating on migration files — reads
# filesystem at runtime instead of baking migrations in at compile time)
cargo sqlx migrate run --source crates/observing-db/migrations
```

In production, migrations run in a one-shot `observing-migrate` Cloud Run Job *before* services are deployed — long-running services never run DDL. See `docs/deployment.md`.

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

All services can be managed with `process-compose`. Config in `process-compose.yaml`.

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

Service names: `cloud-sql-proxy`, `appview`, `frontend`, `ingester`, `species-id`

### Individual Services

```bash
# AppView (REST API + OAuth + media cache + GBIF taxonomy + static files on port 3000)
cargo run -p observing-appview

# Ingester (firehose consumer)
cargo run -p observing-ingester

# Frontend dev server (serves frontend if `npm run build` hasn't been run)
npm run dev
```

### Frontend Development

If there's nothing in `dist/public`, the appview running on port 3000 will proxy frontend requests to the hot-reloading Vite server running in the `frontend` process.

If you want to mimic a more production-like setup, rebuild the static frontend files and restart:

```bash
npm run build && process-compose process restart appview
```

The app runs at `http://localhost:3000` (not 5173). Port 3000 serves built files from `dist/public`.

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
