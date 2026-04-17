# Deployment

## Google Cloud Run

Services deployed via GitHub Actions (`.github/workflows/ci.yml`):

| Service | Build arg | Public | Cloud SQL | Notes |
|---------|-----------|--------|-----------|-------|
| observing-appview | `SERVICE=observing-appview` | Yes | Yes | REST API + OAuth + media cache + GBIF taxonomy + serves frontend |
| observing-ingester | `SERVICE=observing-ingester` | Yes | Yes | min-instances=1 (always running) |
| observing-species-id | `SERVICE=observing-species-id` | Yes | No | BioCLIP species identification (2 CPU, 4 GiB) |

All services are built from the root `Dockerfile` using `--build-arg SERVICE=<name>`.

All services are Rust binaries built from the shared multi-stage `Dockerfile` at the project root.

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

### AppView

```bash
PORT=3000
PUBLIC_URL=https://your-domain.run.app
SPECIES_ID_SERVICE_URL=https://observing-species-id-xxx.run.app  # Optional
HIDDEN_DIDS=did:plc:abc123  # Comma-separated DIDs to hide from feeds

# Media cache (in-process, served at /media/{blob,thumb}/{did}/{cid})
CACHE_DIR=./cache/media
MAX_CACHE_SIZE=...      # Optional, bytes
CACHE_TTL_SECS=...      # Optional, seconds
```

### Species ID

```bash
PORT=3005
MODEL_DIR=/app/models/bioclip
ORT_DYLIB_PATH=/usr/lib/libonnxruntime.so
```
