# Deployment

## Google Cloud Run

Services deployed via GitHub Actions (`.github/workflows/ci.yml`):

| Service | Build arg | Public | Cloud SQL | Notes |
|---------|-----------|--------|-----------|-------|
| observing-appview | `SERVICE=observing-appview` | Yes | Yes (`observing` db) | REST API + OAuth + serves frontend |
| observing-ingester | `SERVICE=observing-ingester` | Yes | Yes (`observing` db) | min-instances=1 (always running) |
| observing-media-proxy | `SERVICE=observing-media-proxy` | Yes | No | Stateless image cache |
| observing-species-id | `SERVICE=observing-species-id` | Yes | No | BioCLIP species identification (2 CPU, 4 GiB) |
| observing-taxonomy | `SERVICE=observing-taxonomy` | Yes | No | GBIF taxonomy lookups with caching |
| quickslice | `Dockerfile.quickslice` | No | Yes (`quickslice` db) | AT Protocol ingestion + GraphQL API |

Rust services are built from the root `Dockerfile` using `--build-arg SERVICE=<name>`. QuickSlice is built from `Dockerfile.quickslice` (Gleam/Erlang).

## Automatic Deploy

Push to `main` triggers deployment after CI checks pass. See `.github/workflows/ci.yml`.

## Environment Variables

### Database (appview, ingester)

```bash
DATABASE_URL=postgresql://user:pass@host:5432/observing

# Or for Cloud SQL:
DB_HOST=/cloudsql/project:region:instance
DB_NAME=observing
DB_USER=postgres
DB_PASSWORD=...
```

### Ingester

```bash
JETSTREAM_URL=wss://jetstream2.us-east.bsky.network/subscribe
```

### QuickSlice

Uses a separate `quickslice` database on the same Cloud SQL instance.

```bash
DATABASE_URL=postgresql://user:pass@localhost/quickslice?host=/cloudsql/project:region:instance
JETSTREAM_URL=wss://jetstream1.us-east.bsky.network/subscribe
```

Lexicons and `domain_authority` config are loaded automatically on startup via `scripts/load-quickslice-lexicons.sh`.

### Media Proxy

```bash
MEDIA_PROXY_PORT=3001
CACHE_DIR=./cache/media
```

### AppView

```bash
PORT=3000
PUBLIC_URL=https://your-domain.run.app
TAXONOMY_SERVICE_URL=https://observing-taxonomy-xxx.run.app
MEDIA_PROXY_URL=https://observing-media-proxy-xxx.run.app
SPECIES_ID_SERVICE_URL=https://observing-species-id-xxx.run.app  # Optional
HIDDEN_DIDS=did:plc:abc123  # Comma-separated DIDs to hide from feeds
```

### Species ID

```bash
PORT=3005
MODEL_DIR=/app/models/bioclip
ORT_DYLIB_PATH=/usr/lib/libonnxruntime.so
```

### Taxonomy

```bash
PORT=8080
RUST_LOG=observing_taxonomy=info
LOG_FORMAT=json  # For GCP Cloud Logging
```
