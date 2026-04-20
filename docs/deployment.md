# Deployment

## Google Cloud Run

Deployed via GitHub Actions (`.github/workflows/ci.yml`) on push to `main` after CI checks pass.

### Services

| Service | Build arg | Public | Cloud SQL | DB role | Notes |
|---------|-----------|--------|-----------|---------|-------|
| observing-appview | `SERVICE=observing-appview` | Yes | Yes | `appview_runtime` | REST API + OAuth + media cache + GBIF taxonomy + serves frontend |
| observing-ingester | `SERVICE=observing-ingester` | Yes | Yes | `ingester_runtime` | min-instances=1 (always running) |
| observing-species-id | `SERVICE=observing-species-id` | Yes | No | — | BioCLIP species identification (2 CPU, 8 GiB, cpu-boost, min-instances=1) |

### Jobs

| Job | Build arg | Cloud SQL | DB role | Notes |
|-----|-----------|-----------|---------|-------|
| observing-migrate | `SERVICE=observing-migrate` | Yes | `postgres` | One-shot `gcloud run jobs deploy` + `execute --wait` — runs `sqlx` migrations *before* any service deploy. Only thing that ever connects as superuser. |

All services and the migrate Job are Rust binaries built from the shared multi-stage `Dockerfile` at the project root using `--build-arg SERVICE=<name>`.

### Deploy order

CI runs the deploy steps in this order to ensure DDL lands before any service starts on the new schema:

1. `Run migrations` → deploys + executes the `observing-migrate` Cloud Run Job.
2. `Deploy ingester` → single-writer for lexicon-derived tables.
3. `Deploy appview` → last, so it sees the fully-migrated schema and up-to-date ingester grants.

## Environment Variables

Database passwords and secrets come from Google Secret Manager; non-secret config is set inline via `--set-env-vars`.

### AppView (`appview_runtime`)

```bash
PORT=3000
PUBLIC_URL=https://your-domain.run.app
SPECIES_ID_SERVICE_URL=https://observing-species-id-xxx.run.app

# Cloud SQL (Unix socket in prod)
DB_HOST=/cloudsql/<project>:<region>:observing-db
DB_NAME=observing
DB_USER=appview_runtime
DB_PASSWORD=<secret: observing-db-appview-password>

# Access control
HIDDEN_DIDS=did:plc:...       # Comma-separated DIDs to hide from feeds
ADMIN_DIDS=did:plc:...        # Comma-separated DIDs with admin-surface access

# Media cache (in-process, served at /media/{blob,thumb}/{did}/{cid})
CACHE_DIR=./cache/media
MAX_CACHE_SIZE=...            # Optional, bytes
CACHE_TTL_SECS=...            # Optional, seconds
```

### Ingester (`ingester_runtime`)

```bash
PORT=8080
JETSTREAM_URL=wss://jetstream2.us-east.bsky.network/subscribe

DB_HOST=/cloudsql/<project>:<region>:observing-db
DB_NAME=observing
DB_USER=ingester_runtime
DB_PASSWORD=<secret: observing-db-ingester-password>
```

### Species-ID

```bash
PORT=3005
MODEL_DIR=/app/models/bioclip
ORT_DYLIB_PATH=/usr/lib/libonnxruntime.so
```

No database access.

### Migrate Job (`postgres`)

```bash
# Full admin URL including superuser credentials; only used during migrations.
DATABASE_URL=<secret: observing-db-admin-url>
```

Developer note: there is **no** `DATABASE_URL` with `DB_USER=postgres` on any long-running service. If you see a local config that sets it, it's stale.

## Local development

For running the stack locally, see `docs/development.md`.
