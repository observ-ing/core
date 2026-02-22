# Deployment

## Google Cloud Run

Services deployed via GitHub Actions (`.github/workflows/ci.yml`):

| Service | Dockerfile | Public | Cloud SQL | Notes |
|---------|------------|--------|-----------|-------|
| observing-appview | crates/observing-appview/Dockerfile | Yes | Yes | REST API + OAuth + serves frontend |
| observing-ingester | crates/observing-ingester/Dockerfile | Yes | Yes | min-instances=1 (always running) |
| observing-media-proxy | crates/observing-media-proxy/Dockerfile | Yes | No | Stateless image cache |
| observing-taxonomy | crates/observing-taxonomy/Dockerfile | Yes | No | GBIF taxonomy lookups with caching |

All services are Rust binaries.

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
HIDDEN_DIDS=did:plc:abc123  # Comma-separated DIDs to hide from feeds
```

### Taxonomy

```bash
PORT=8080
RUST_LOG=observing_taxonomy=info
LOG_FORMAT=json  # For GCP Cloud Logging
```
