# Observ.ing Ingester (Rust)

High-performance AT Protocol firehose ingester for Observ.ing, rewritten in Rust for better performance.

## Building

```bash
cargo build --release
```

## Running Locally

Point at a local PostgreSQL (with PostGIS) — see `docs/development.md` for setup.

```bash
DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/observing" \
cargo run --release
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes* | - | PostgreSQL connection string |
| `CURSOR` | No | - | Starting cursor position |
| `PORT` | No | `8080` | HTTP server port |
| `RUST_LOG` | No | `observing_ingester=info` | Log level |

*If `DATABASE_URL` is unset, the ingester builds one from the env vars below. This fallback exists for Cloud Run's Cloud SQL Unix-socket integration in production (`DB_HOST=/cloudsql/project:region:instance`); local development should prefer `DATABASE_URL`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_HOST` | Yes* | - | Database host or Unix-socket path |
| `DB_NAME` | No | `observing` | Database name |
| `DB_USER` | No | `postgres` | Database user |
| `DB_PASSWORD` | No | - | Database password |
| `DB_PORT` | No | `5432` | Database port (ignored when `DB_HOST` is a Unix socket) |

## Endpoints

- `GET /` - Dashboard UI
- `GET /health` - Health check (for Cloud Run)
- `GET /api/stats` - JSON stats endpoint

## Deploying to Cloud Run

Deployment is handled automatically via CI. See `.github/workflows/ci.yml`.

## Docker

```bash
# Build
docker build -t observing-ingester .

# Run
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  observing-ingester
```
