# Deployment

## Google Cloud Run

Deployed via GitHub Actions (`.github/workflows/ci.yml`) on push to `main` after CI checks pass.

### Services and jobs

[infra/README.md](../infra/README.md) lists every service and job: what it does, how it's sized, and why each deploy flag is set the way it is.

### Deploy order

CI runs the deploy steps in this order to ensure DDL lands before any service starts on the new schema:

1. `Run migrations` → deploys + executes the `observing-migrate` Cloud Run Job.
2. `Deploy worker` → before tap-ingester and the appview, which start queuing runs for it.
3. `Deploy tap-ingester` → single-writer for lexicon-derived tables.
4. `Deploy appview` → last, so it sees the fully-migrated schema and up-to-date ingester grants.

### Cloud Tasks

Background tasks run in `observing-worker`, a private Cloud Run service: the appview image with `APPVIEW_TASK_ROUTES=1`, serving `POST /tasks/<task>` for each task in the registry in `crates/observing-tasks` ([infra/README.md](../infra/README.md#observing-worker) has the reasons). Each task has its own Cloud Tasks queue, named after it, and an hourly Cloud Scheduler job as a backstop. Callers need no configuration: on Cloud Run, `observing-tasks` finds the project and region from the metadata server, and the worker at `https://observing-worker-<project number>.<region>.run.app`. CI deploys the worker; the queues, the invoker account, the IAM bindings and the scheduler jobs are set up once, by hand.

| Task | Queued by | Path |
|------|-----------|------|
| `resolve-taxa` | tap-ingester, the minute after it writes an identification | `/tasks/resolve-taxa` |
| `inat-crossposts` | the appview, when someone asks to cross-post; each run queues the next when a retry comes due | `/tasks/inat-crossposts` |

Until the setup exists, nothing breaks: tap-ingester logs `Failed to queue a task run` and identifications stay unresolved, and the appview logs `Failed to queue a cross-post run` and cross-posts stay `pending`.

Before the first deploy:

```bash
PROJECT=observ-ing
REGION=us-central1
INVOKER=cloud-tasks-invoker@$PROJECT.iam.gserviceaccount.com
# The account the Cloud Run services run as.
RUNTIME_SA=$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com
TASKS="resolve-taxa inat-crossposts"

gcloud services enable cloudtasks.googleapis.com cloudscheduler.googleapis.com --project=$PROJECT

# The identity tasks and the scheduler jobs call the worker as. Callers mint
# its OIDC token on each task.
gcloud iam service-accounts create cloud-tasks-invoker --project=$PROJECT \
  --display-name="Calls private Cloud Run services for Cloud Tasks and Cloud Scheduler"
gcloud iam service-accounts add-iam-policy-binding $INVOKER --project=$PROJECT \
  --member=serviceAccount:$RUNTIME_SA --role=roles/iam.serviceAccountUser

# One queue per task, one run at a time; a failed run is retried with backoff.
# At most one a second also keeps inat-crossposts within iNaturalist's 60
# requests a minute.
for QUEUE in $TASKS; do
  gcloud tasks queues create $QUEUE --project=$PROJECT --location=$REGION \
    --max-concurrent-dispatches=1 --max-dispatches-per-second=1 \
    --max-attempts=5 --min-backoff=30s --max-backoff=600s
  gcloud tasks queues add-iam-policy-binding $QUEUE --project=$PROJECT --location=$REGION \
    --member=serviceAccount:$RUNTIME_SA --role=roles/cloudtasks.enqueuer
done
```

After the first deploy, once `observing-worker` exists:

```bash
URL=$(gcloud run services describe observing-worker --project=$PROJECT --region=$REGION --format='value(status.url)')

gcloud run services add-iam-policy-binding observing-worker --project=$PROJECT --region=$REGION \
  --member=serviceAccount:$INVOKER --role=roles/run.invoker

for QUEUE in $TASKS; do
  gcloud scheduler jobs create http $QUEUE-backstop --project=$PROJECT --location=$REGION \
    --schedule="0 * * * *" --uri=$URL/tasks/$QUEUE --http-method=POST \
    --oidc-service-account-email=$INVOKER --oidc-token-audience=$URL \
    --attempt-deadline=900s
done

# Run the first resolution pass now rather than at the top of the hour. With
# a backlog it continues on the queue in 10-minute pieces.
gcloud scheduler jobs run resolve-taxa-backstop --project=$PROJECT --location=$REGION
```

Adding a task to an existing setup: run the queue loop and the scheduler loop above with `TASKS` set to just the new task (for cross-posts, `TASKS="inat-crossposts"`).

Moving from `observing-resolve-taxa` (#955): the queue, account and bindings stay. Grant `run.invoker` on the worker as above, point the backstop at it with `gcloud scheduler jobs update http resolve-taxa-backstop --uri=$URL/tasks/resolve-taxa --oidc-service-account-email=$INVOKER --oidc-token-audience=$URL` (gcloud refuses the audience without the account), then `gcloud run services delete observing-resolve-taxa`.

To check on it, `gcloud tasks list --queue=<task> --project=$PROJECT --location=$REGION` shows runs waiting, and the worker's logs show `Resolution pass finished` with `updated_rows` after each pass, and `Cross-post run finished` after each cross-post run.

### Service status dashboard

The [Service Status](https://console.cloud.google.com/monitoring/dashboards/builder/4a03aa0a-e9a4-4f65-8168-b09030aeb432?project=observ-ing) Cloud Monitoring dashboard shows each Cloud Run service's instance count: 0 means asleep (scaled to zero), and 1 or more means awake. It also shows active vs idle instances over time, Cloud SQL up/down, and running job executions. Instance counts arrive about 3 minutes after Cloud Run samples them.

The source is `infra/monitoring/service-status-dashboard.json`. It isn't deployed by CI. After editing the file, push it by hand. The update call needs the live dashboard's current etag:

```bash
ID=4a03aa0a-e9a4-4f65-8168-b09030aeb432
ETAG=$(gcloud monitoring dashboards describe $ID --project=observ-ing --format='value(etag)')
jq --arg etag "$ETAG" '. + {etag: $etag}' infra/monitoring/service-status-dashboard.json > /tmp/dashboard.json
gcloud monitoring dashboards update $ID --project=observ-ing --config-from-file=/tmp/dashboard.json
```

The public `/status` page (`GET /api/status`, in `crates/observing-appview/src/service_status.rs`) reads the same metrics, so it has its own list of services to show. Adding a Cloud Run service means updating that list and adding a scorecard tile here. The time-series charts group by `service_name`, so they pick up new services automatically. The scorecards use `... or vector(0)` because Cloud Run stops reporting `instance_count` for a service a few minutes after it scales to zero. Without the fallback, a sleeping service would read "No data" instead of 0.

### System health dashboard

The [System Health](https://console.cloud.google.com/monitoring/dashboards/builder/4046b455-644f-4615-99cc-d4eae66aae0d?project=observ-ing) Cloud Monitoring dashboard shows resource use over time:

- memory and CPU for each Cloud Run service, as a fraction of its limit, with tap-ingester's p50 and p99 charted on their own
- tap-ingester's firehose bytes received per second, its liveness signal
- observing-appview's request rate and p95 latency
- observing-db's CPU, memory, connections, commits per second and disk use

The source is `infra/monitoring/system-health-dashboard.json`. Like Service Status, it isn't deployed by CI. After editing the file, push it by hand with the same etag steps:

```bash
ID=4046b455-644f-4615-99cc-d4eae66aae0d
ETAG=$(gcloud monitoring dashboards describe $ID --project=observ-ing --format='value(etag)')
jq --arg etag "$ETAG" '. + {etag: $etag}' infra/monitoring/system-health-dashboard.json > /tmp/dashboard.json
gcloud monitoring dashboards update $ID --project=observ-ing --config-from-file=/tmp/dashboard.json
```

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
# Optional: faster ViT-L service for the live camera loop. When unset, live
# requests fall back to SPECIES_ID_SERVICE_URL (the full ViT-H model).
SPECIES_ID_LIVE_SERVICE_URL=https://observing-species-id-live-xxx.run.app
# Optional: GCP project whose Cloud Monitoring backs the public /status page.
# Unset (e.g. local dev) makes /api/status return 503.
GCP_PROJECT_ID=observ-ing

# Cloud SQL (Unix socket in prod)
DB_HOST=/cloudsql/<project>:<region>:observing-db
DB_NAME=observing
DB_USER=appview_runtime
DB_PASSWORD=<secret: observing-db-appview-password>

# Access control
HIDDEN_DIDS=did:plc:...       # Comma-separated DIDs to hide from feeds
ADMIN_DIDS=did:plc:...        # Comma-separated DIDs with admin-surface access

# iNaturalist cross-posting (OAuth app at inaturalist.org/oauth/applications;
# redirect URI {PUBLIC_URL}/api/inat/callback). Feature is off unless both set.
INAT_CLIENT_ID=<secret: INAT_CLIENT_ID>
INAT_CLIENT_SECRET=<secret: INAT_CLIENT_SECRET>

# Serve the /tasks/* routes Cloud Tasks calls. Only observing-worker (and
# local dev) sets it, along with the INAT_* secrets above for cross-posts and
# a second role for tasks that write the ingester schema (resolution passes):
# APPVIEW_TASK_ROUTES=1
# INGESTER_DB_USER=ingester_runtime
# INGESTER_DB_PASSWORD=<secret: observing-db-ingester-password>
# (or INGESTER_DATABASE_URL=postgres://... locally)

# Media cache (in-process, served at /media/{blob,thumb}/{did}/{cid})
CACHE_DIR=./cache/media
MAX_CACHE_SIZE=...            # Optional, bytes
CACHE_TTL_SECS=...            # Optional, seconds
```

### Tap-Ingester (`ingester_runtime`)

```bash
PORT=8080

DB_HOST=/cloudsql/<project>:<region>:observing-db
DB_NAME=observing
DB_USER=ingester_runtime
DB_PASSWORD=<secret: observing-db-ingester-password>

# Optional: connect to an external Tap rather than spawning the bundled
# binary. Unset in production; useful for local dev when running Tap in
# Docker separately.
# TAP_URL=http://localhost:2480
# TAP_ADMIN_PASSWORD=<secret>

# Optional: backing DB for the embedded Tap.
#
# When unset (the production default), tap-ingester derives a Postgres
# URL from the same DB_HOST/DB_NAME/DB_USER/DB_PASSWORD vars used for
# the app DB and appends `options=-c search_path=tap`, so Tap's tables
# land in the dedicated `tap` schema. State persists across deploys.
#
# When neither TAP_DATABASE_URL nor DB_HOST is set, falls back to
# `sqlite:///data/tap.db` (instance-ephemeral). Set explicitly to
# override either default.
# TAP_DATABASE_URL=postgres://...

# Optional: `off` stops it asking for resolution passes after new
# identifications. Otherwise it asks through Cloud Tasks (observing-worker)
# on Cloud Run, and by POSTing to the dev appview at localhost:$APPVIEW_PORT
# (default 3000) elsewhere.
# OBSERVING_TASKS=off
```

Writes the `ingester` schema. Cross-repo identifications referencing
occurrences on DIDs Tap hasn't backfilled yet trigger a `/repos/add`
call to the embedded Tap and skip the ack so the redelivered event
lands after backfill completes.

### Species-ID

```bash
PORT=3005
MODEL_DIR=/app/models/bioclip
ORT_DYLIB_PATH=/usr/lib/libonnxruntime.so
# Reported in /identify + /health responses. Defaults to the ViT-H build's
# string; the live ViT-L image bakes this in via the MODEL_VERSION build-arg.
MODEL_VERSION=bioclip-2.5-vit-h-14
```

No database access. Both `observing-species-id` and `observing-species-id-live` use this same config; they differ only in the baked model bundle and `MODEL_VERSION`.

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
gcloud run services update tap-ingester --region=us-central1 --min-instances=0

# 2. Connect via the Cloud SQL proxy as superuser.
gcloud auth application-default login   # if ADC is stale
cloud-sql-proxy observ-ing:us-central1:observing-db --port=5433 &
ADMIN_URL=$(gcloud secrets versions access latest --secret=observing-db-admin-url)
PGPASSWORD=$(python3 -c "import urllib.parse,sys; print(urllib.parse.urlparse(sys.argv[1]).password)" "$ADMIN_URL") \
  psql -h 127.0.0.1 -p 5433 -U postgres -d observing <<'SQL'
BEGIN;
DROP SCHEMA IF EXISTS appview CASCADE;
DROP SCHEMA IF EXISTS ingester CASCADE;
DROP SCHEMA IF EXISTS tap CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO public;
COMMIT;
SQL

# 3. Re-run migrations.
gcloud run jobs execute observing-migrate --region=us-central1 --wait

# 4. Bounce both services so they pick up fresh connections.
gcloud run services update tap-ingester --region=us-central1 --min-instances=1 --update-env-vars=BOUNCE=$(date +%s)
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
