# Observ.ing Ingester (Rust)

High-performance AT Protocol firehose ingester for Observ.ing, rewritten in Rust for better performance.

## Building

```bash
cargo build --release
```

## Running Locally

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

*Either `DATABASE_URL` or Cloud SQL environment variables are required:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_HOST` | Yes* | - | Database host or Cloud SQL socket path (e.g., `/cloudsql/project:region:instance`) |
| `DB_NAME` | No | `observing` | Database name |
| `DB_USER` | No | `postgres` | Database user |
| `DB_PASSWORD` | No | - | Database password |
| `DB_PORT` | No | `5432` | Database port (ignored for Cloud SQL sockets) |

## Endpoints

- `GET /` - Dashboard UI
- `GET /health` - Health check (for Cloud Run)
- `GET /api/stats` - JSON stats endpoint

## Deploying to Cloud Run

### Using gcloud directly

```bash
# Build and push to GCR
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/observing-ingester

# Deploy to Cloud Run
gcloud run deploy observing-ingester \
  --image gcr.io/YOUR_PROJECT_ID/observing-ingester \
  --region us-central1 \
  --cpu 4 \
  --memory 2Gi \
  --min-instances 1 \
  --max-instances 1 \
  --timeout 3600 \
  --set-env-vars "DATABASE_URL=your-db-url,RUST_LOG=observing_ingester=info" \
  --allow-unauthenticated
```

### Using Cloud Build

```bash
gcloud builds submit --config cloudbuild.yaml
```

## Docker

```bash
# Build
docker build -t observing-ingester .

# Run
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  observing-ingester
```
