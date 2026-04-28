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

## Runtime role boundary (one-shot)

Cloud SQL auto-grants `cloudsqlsuperuser` to every built-in user, and that membership confers `arwdDxt` on every table via role inheritance — which nullifies the per-schema grants in the `appview_reader_grants` migration. To actually enforce the boundary, `cloudsqlsuperuser` must be stripped from `appview_runtime` and `ingester_runtime`. This is a one-shot operation tied to user creation, not deploy state, so it lives here as a runbook step rather than a CI step:

```bash
for USER in appview_runtime ingester_runtime; do
  gcloud sql users assign-roles $USER \
    --instance=observing-db \
    --database-roles=runtime_base \
    --revoke-existing-roles \
    --type=BUILT_IN
done
```

`runtime_base` is an empty placeholder role created by the migrate Job, required only because `--database-roles=` needs a non-empty value. Direct per-table grants on each user stay intact through the swap. Re-run this command any time a runtime user is recreated.

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

## Wiping the database (pre-launch)

While the project is pre-launch, occasionally we want a clean slate: drop all
data and re-run migrations from scratch. The trick is that the app tables
live across three schemas (`public`, `ingester`, `appview`), the sqlx
migrations ledger lives in `ingester._sqlx_migrations`, and runtime role
memberships persist at the Cloud SQL instance level (so you can't undo
"renames already happened" by dropping the database).

```bash
# 1. Pause the writer.
gcloud run services update observing-ingester --region=us-central1 --min-instances=0

# 2. Connect via the Cloud SQL proxy as superuser.
gcloud auth application-default login   # if ADC is stale
cloud-sql-proxy observ-ing:us-central1:observing-db --port=5433 &
ADMIN_URL=$(gcloud secrets versions access latest --secret=observing-db-admin-url)
PGPASSWORD=$(python3 -c "import urllib.parse,sys; print(urllib.parse.urlparse(sys.argv[1]).password)" "$ADMIN_URL") \
  psql -h 127.0.0.1 -p 5433 -U postgres -d observing <<'SQL'
BEGIN;
DROP SCHEMA IF EXISTS appview CASCADE;
DROP SCHEMA IF EXISTS ingester CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO public;
COMMIT;
SQL

# 3. Re-run migrations.
gcloud run jobs execute observing-migrate --region=us-central1 --wait

# 4. Bounce both services so they pick up fresh connections.
gcloud run services update observing-ingester --region=us-central1 --min-instances=1 --update-env-vars=BOUNCE=$(date +%s)
gcloud run services update observing-appview  --region=us-central1 --update-env-vars=BOUNCE=$(date +%s)

# 5. Stop the proxy.
pkill -f "cloud-sql-proxy observ-ing"
```

Why drop *all* the schemas, not just `public`: the app tables and the sqlx
migrations ledger live in `ingester`/`appview`. Dropping only `public` leaves
the ledger intact, which makes the next migrate Job a no-op.

The grant migrations (20260418, 20260419, 20260421) target the pre-rename
role names; on a from-scratch migrate they no-op. Migration 20260428000001
re-issues the canonical grants against `appview_runtime` / `ingester_runtime`
so this runbook produces a working DB without manual grant SQL.

## Local development

For running the stack locally, see `docs/development.md`.
