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

```bash
export DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/observing"
export PORT=3000
```

## Common Commands

```bash
# Install dependencies
npm install

# Build frontend
npm run build

# Typecheck frontend
npx tsc

# Build Rust workspace
cargo build

# Run Rust tests
cargo test --workspace

# Generate lexicon types (Rust)
npm run generate-rust-types

# Generate lexicon types (TypeScript)
npm run generate-types
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

Service names: `cloud-sql-proxy`, `appview`, `frontend`, `media-proxy`, `ingester`

### Individual Services

```bash
# AppView (REST API + OAuth + static files on port 3000)
cargo run -p observing-appview

# Ingester (firehose consumer)
cargo run -p observing-ingester

# Media Proxy (image proxy on port 3001)
cargo run -p observing-media-proxy

# Taxonomy (GBIF resolver on port 3003)
cargo run -p observing-taxonomy

# Frontend dev server
npm run dev
```

### After Frontend Changes

Rebuild and restart:
```bash
npm run build && process-compose process restart appview
```

The app runs at `http://localhost:3000` (not 5173). Port 3000 serves built files from `dist/public`.

## Tests
Backend tests with `cargo test --workspace` should run without setup.

Frontend tests with `npm run test:e2e` require a real Bluesky test account with these credentials in environmental variables: `BLUESKY_TEST_EMAIL`, `BLUESKY_TEST_PASSWORD`, `BLUESKY_TEST_HANDLE`.

e2e tests are truly end-to-end, so you need to have a full stack running for them to complete. The whole thing might look like this:

```sh
# Start full development stack
process-compose up -D

# Set up Bluesky credentials
export BLUESKY_TEST_EMAIL=your-test-bluesky-email@yourmail.com
export BLUESKY_TEST_PASSWORD=your-test-bluesky-password
export BLUESKY_TEST_HANDLE=your-test-bluesky-handle.bsky.social

# Run the tests
npm run test:e2e
```
