# Development

## Prerequisites

- Node.js 20+
- PostgreSQL with PostGIS extension
- Rust (for ingester and media-proxy)

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

# Build all packages
npm run build

# Typecheck
npx tsc

# Run tests
npm run test:run      # Run once
npm run test          # Watch mode
npm run test:coverage # With coverage

# Generate lexicon types
npm run generate-types
```

## Running Services

### Individual Services

```bash
npm run appview       # REST API on port 3000
npm run ingester      # Firehose consumer
npm run media-proxy   # Image proxy on port 3001
npm run frontend:dev  # Vite dev server
```

### Using process-compose

All services can be managed with `process-compose`. Config in `process-compose.yaml`.

```bash
# Start all services (detached)
process-compose up -D

# View processes
process-compose process list

# Stop/start individual services
process-compose process stop <name>
process-compose process start <name>

# View logs
process-compose process logs <name>

# Stop all
process-compose down
```

Service names: `cloud-sql-proxy`, `appview`, `frontend`, `media-proxy`, `ingester`

## Running Rust Services

```bash
# Ingester
cd crates/observing-ingester
DATABASE_URL="postgresql://..." cargo run

# Media Proxy
cd crates/observing-media-proxy
cargo run
```
