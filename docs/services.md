# Services

What runs in production, how each piece is sized, and why. The deploy commands in `.github/workflows/ci.yml` hold the flags. This file holds the reasons. When you change a flag, update the matching section here in the same PR.

Everything runs in the `observ-ing` GCP project, region `us-central1`. Deploy order and the dashboard runbooks are in [deployment.md](deployment.md).

## At a glance

| Name | Kind | Does | CPU / memory | Instances | CPU billing | DB role |
|------|------|------|--------------|-----------|-------------|---------|
| [observing-appview](#observing-appview) | Cloud Run service | REST API, OAuth, media cache, serves the frontend | 1 vCPU / 512 MiB* | 0–20* | Request-based | `appview_runtime` |
| [tap-ingester](#tap-ingester) | Cloud Run service | Consumes the AT Protocol firehose and writes records | 1 vCPU / 512 MiB | 1–1 | Instance-based (always on) | `ingester_runtime` |
| [observing-species-id](#observing-species-id) | Cloud Run service | BioCLIP ViT-H/14 species ID for uploads | 2 vCPU / 8 GiB | 0–10* | Request-based | — |
| [observing-species-id-live](#observing-species-id-live) | Cloud Run service | BioCLIP ViT-L/14 species ID for the live camera | 2 vCPU / 4 GiB | 0–10* | Request-based | — |
| [storybook](#storybook) | Cloud Run service | Component library for development | 1 vCPU / 128 MiB | 0–3 | Request-based | — |
| [observing-migrate](#observing-migrate) | Cloud Run job | Runs migrations before each deploy | Default | — | — | `postgres` |
| [observing-task-runner](#observing-task-runner) | Cloud Run job | Backfills and replays, run by hand | Default | — | — | `ingester_runtime` |
| [observing-db](#observing-db) | Cloud SQL | PostgreSQL 18 for everything above | 1 vCPU / 4 GB | — | — | — |

\* Not set in `ci.yml`. Cloud Run keeps a flag's previous value when a deploy leaves it out, so these are the live values as of 2026-10-17. Changing them means a one-off `gcloud run services update`, or adding the flag to the deploy step so it is pinned.

All Rust services and jobs come from the root `Dockerfile`, built with `--build-arg SERVICE=<name>`. CI builds all six images in one `docker buildx bake` run (`docker-bake.hcl`), and one Rust build stage compiles every service's binary. Storybook has its own `Dockerfile.storybook`.

## observing-appview

The public API at `https://observ.ing`. It serves the REST API, OAuth, the media cache, GBIF taxonomy lookups, and the built frontend. Code is in `crates/observing-appview/`.

- **Sizing.** Its CPU, memory, max instances (20) and concurrency (80) come from the live service, not `ci.yml`. In a 6-hour sample on 2026-10-17, p99 memory peaked at 25% of 512 MiB. It scales to zero. Request-based charges for all services together came to a few cents a day in October 2026.
- **Database.** Each instance opens a pool of up to 50 connections (`PoolConfig::service()` in `crates/observing-bootstrap/src/db.rs`). At 20 instances that could exceed Cloud SQL's connection limit, so lower the pool or the max instances before traffic grows. Over 30 days the whole `observing` database peaked at 35 connections.
- **Calls out to.** observing-species-id and observing-species-id-live (URLs set at deploy), and tap-ingester at `https://ingester.observ.ing` for the admin stats tables.
- **Secrets.** `observing-db-appview-password`, `INAT_CLIENT_ID`, `INAT_CLIENT_SECRET`.

## tap-ingester

The only writer for records that come from the network. It bundles the upstream Tap binary (Go, built from the indigo commit pinned in `Dockerfile` as `INDIGO_REV`), runs it as a child process, filters the firehose for our lexicons and upserts records. Code is in `crates/tap-ingester/`. Its stats and dashboard are public at `https://ingester.observ.ing`.

- **Always-on CPU (`--no-cpu-throttling`) is required.** The consumer is a background loop, not request-driven. Under Cloud Run's default, CPU drops to almost nothing between HTTP requests. The ingester then caps at a few hundred events per second and falls behind the relay's ~72-hour retention window for good (incident 2026-05-31).
- **One instance, exactly (`--min-instances=1 --max-instances=1`).** There is one consumer per cursor.
- **1 vCPU.** Throughput is limited by Tap's per-event serialization, not CPU. At 2 vCPU over 14 days, the 1-minute p99 peaked at about 0.62 vCPU, post-deploy catch-up included. At 1 vCPU (20 days to 2026-10-17) it averages about 0.2 vCPU. Its 1-minute p99 reached about 0.74 in the last 7 days and briefly came close to 1.0 once. Always-on CPU can't go below 1 vCPU.
- **512 MiB.** At 1 GiB, 1-minute p99 memory never passed 9% (about 92 MiB) over 20 days, deploys included. 512 MiB is the minimum for always-on CPU.
- **State.** Tap keeps its tracked repos and cursors in the Cloud SQL `tap` schema (`search_path=tap`), so they survive deploys. The local `/data` folder is only used when no database is configured, as in early local development.
- **Database.** Up to 10 connections for the ingester and up to 10 for Tap (`TAP_MAX_DB_CONNS`). Tap's state writes are likely most of the database's ~370 commits per second.
- **Cost.** About $50/month, which is most of the Cloud Run bill, because always-on CPU is billed around the clock.
- **Watch.** On the System Health dashboard, firehose bytes received should sit around 2 MB/s. Zero means the consumer has stalled.

## observing-species-id

Full-accuracy BioCLIP 2.5 ViT-H/14 identification, used by the upload and capture flows. Code is in `crates/observing-species-id/`. The ~3.3 GB model bundle (ONNX weights plus species embeddings) is baked into the image.

- **gen2 execution environment.** Startup time is spent reading the model bundle. On gen1 the image filesystem reads at about 40 MB/s, so the service takes 90–100 s to be ready. On gen2 it reads at about 260 MB/s, so it's ready in about 20 s.
- **Startup probe every 2 s** (TCP 8080, 150 failures allowed, so the same 300 s budget). Readiness isn't delayed up to 10 s after the model finishes loading.
- **Scales to zero (`--min-instances=0`).** Identification traffic is a handful of requests a week. A warm 8 GiB instance cost about $65/month for about $1/month of inference. The appview's `/api/species-id/status` probe starts a boot when the upload UI opens, and the frontend shows a countdown (`species_id_client.rs`).
- **8 GiB.** The ViT-H bundle is about 4.4 GB resident.

## observing-species-id-live

The same binary as observing-species-id, built with the smaller, faster ViT-L/14 bundle ([bioclip-models release `vit-l-v1.0.0`](https://github.com/observ-ing/bioclip-models/releases/tag/vit-l-v1.0.0)) via the `SPECIES_MODEL_URL` and `MODEL_VERSION` build args. It serves the live camera loop: the frontend sends `live: true` and the appview routes it here through `SPECIES_ID_LIVE_SERVICE_URL`.

- **4 GiB.** The ViT-L bundle is about 3 GB resident.
- **Scales to zero.** The live feature is experimental and gets almost no traffic. Set min instances back to 1 if it launches and cold starts hurt.
- **gen2 and the 2 s startup probe**, for the same reasons as above. Ready in about 12 s instead of about 75 s.

## storybook

The static Storybook build, served by static-web-server. It's built and deployed by the `storybook-deploy` CI job into the separate `storybook` Artifact Registry repository. Cloud Run is cheaper than an HTTPS load balancer in front of Cloud Storage, cold starts are fine for a development tool, and the free tier covers the traffic.

## observing-migrate

A Cloud Run job that applies pending `sqlx` migrations. CI deploys and runs it (`execute --wait`) before any service deploys, so new code never starts on an old schema. It connects as `postgres` through the `observing-db-admin-url` secret, and it is the only thing that holds that credential. No retries, 10-minute timeout.

## observing-task-runner

A Cloud Run job for one-off operational work such as backfills and replaying failed records. Code is in `crates/observing-task-runner/`. CI deploys it but never runs it. An operator starts a run:

```bash
gcloud run jobs execute observing-task-runner --region=us-central1 \
  --wait --args=backfill-occurrences,--dry-run,--all
```

It runs as `ingester_runtime`, the same writes as the firehose path, so no admin credential is involved. No retries, 1-hour timeout.

## observing-db

Cloud SQL for PostgreSQL 18, Enterprise edition. It was created by hand and isn't managed by CI, so this section is its only record.

| Setting | Value |
|---------|-------|
| Tier | `db-custom-1-4096` (1 dedicated vCPU, 4 GB) |
| Availability | Single zone (`us-central1-c`), no high availability |
| Storage | 10 GB SSD with auto-resize. About 0.2 GB is used. |
| Backups | **Off**, and point-in-time recovery is off too. Daily backups for a database this size would cost cents a month. |
| Connections | Default limit for the tier. Typical use is about 11 connections, and the 30-day peak was 35. |
| Databases | `observing` (schemas `ingester`, `tap`, `appview`, `public`) and `quickslice` |

- **Load (30 days to 2026-10-17).** Daily average CPU rose from 21% to 29%. Memory use is about 350 MB, and there are about 370 commits per second.
- **Cost.** About $51/month: vCPU $30, memory $20, storage $1.70.
- **Smaller tier.** `db-g1-small` (shared core, 1.7 GB) would cost about $27/month. Its default connection limit is 50, there's no SLA, and the current CPU load would use about 60% of its sustained share. Cut Tap's write rate first.

## Supporting infrastructure

- **Artifact Registry.** The `observing` repository holds the service images and their `:buildcache` images. Cleanup deletes untagged versions after 30 days and keeps the 15 most recent of each image. The `storybook` repository deletes anything older than 30 days and keeps 5. Most of its cost is internet egress, not storage: the GitHub Actions runner downloads `:buildcache` layers it needs to rebuild. Two things keep that down. The images are built in one bake run, so shared Rust layers are downloaded once per push. The final binary copies use `COPY --link`, so a changed binary doesn't download the image beneath it.
- **Monitoring.** The [Service Status](https://console.cloud.google.com/monitoring/dashboards/builder/4a03aa0a-e9a4-4f65-8168-b09030aeb432?project=observ-ing) dashboard shows which services are awake. The [System Health](https://console.cloud.google.com/monitoring/dashboards/builder/4046b455-644f-4615-99cc-d4eae66aae0d?project=observ-ing) dashboard shows memory, CPU, firehose throughput, appview requests and database load over time. Their sources are in `infra/monitoring/`.

## Changing a service

1. Change the flag in the deploy step in `.github/workflows/ci.yml`. For a value marked * above, add the flag so it stays pinned.
2. Update the table and the service's section here.
3. When adding a Cloud Run service, also add it to the public status page's list (`crates/observing-appview/src/service_status.rs`) and give it a scorecard on the Service Status dashboard (see [deployment.md](deployment.md#service-status-dashboard)).
4. When adding an image, give it a target in `docker-bake.hcl` and add it to the `default` group. For a new Rust binary, also add its package to `RUST_PACKAGES` in the `Dockerfile` and give it a `runtime-<name>` stage that ends with `COPY --link`.
