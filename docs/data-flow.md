# Data Flow & Database Access

This document describes how data flows through the Observ.ing system and which services access which database tables.

> **Companion doc:** see `architecture.md` for the higher-level service topology and role/privilege model. This doc focuses on how records move end-to-end and which service is allowed to write what.

## Architecture Overview

```mermaid
flowchart TB
    subgraph Frontend["Frontend (React)"]
        Modal["Create Observation Modal<br/>UploadModal.tsx"]
        FormData["Form Data<br/>• species<br/>• location (lat/lng)<br/>• photos<br/>• notes<br/>• license<br/>• co-observers"]
        Base64["Base64 Encode Images"]
        Modal --> FormData --> Base64
    end

    subgraph AppView["AppView (Rust/Axum) — DB_USER=appview_runtime"]
        API["POST /api/occurrences<br/>routes/occurrences/"]
        Auth["OAuth Authentication"]
        BlobUpload["Upload Media to PDS<br/>(createRecord bio.lexicons.temp.v0-1.media)"]
        GBIF["Taxonomy validation<br/>(in-process GBIF + Wikidata)"]
        Geocode["Reverse Geocoding<br/>Nominatim API"]
        BuildRecord["Build AT Protocol Record<br/>bio.lexicons.temp.v0-1.occurrence"]
        PrivateData["Write Exact Coordinates<br/>appview.occurrence_private_data"]
    end

    subgraph ATProtocol["AT Protocol"]
        PDS["User's Personal Data Server<br/>createRecord()"]
        URI["Returns URI + CID<br/>at://did:plc:xxx/bio.lexicons.temp.v0-1.occurrence/rkey"]
    end

    subgraph Firehose["AT Protocol Network"]
        Jetstream["Jetstream<br/>wss://jetstream2.us-east.bsky.network"]
        Filter["Wanted collections:<br/>• bio.lexicons.temp.v0-1.occurrence<br/>• bio.lexicons.temp.v0-1.identification<br/>• ing.observ.temp.comment<br/>• ing.observ.temp.interaction<br/>• ing.observ.temp.like"]
    end

    subgraph Ingester["Ingester (Rust) — DB_USER=ingester_runtime"]
        WS["WebSocket Connection<br/>(jetstream-client crate)"]
        Parse["Parse JSON Event"]
        Resolve["Resolve associatedMedia strong refs<br/>(fetch media records from PDSes)"]
        Upsert["Upsert to Database<br/>database.rs"]
    end

    subgraph Database["PostgreSQL + PostGIS"]
        subgraph IngSchema["schema: ingester"]
            Occurrences["occurrences"]
            Identifications["identifications"]
            Comments["comments, likes, interactions"]
            Observers["occurrence_observers"]
            Notifications["notifications"]
            Cursor["ingester_state"]
            Matview["community_ids (matview)"]
        end
        subgraph AppvSchema["schema: appview"]
            PrivData["occurrence_private_data"]
            OauthTbls["oauth_sessions, oauth_state"]
            NotifReads["notification_reads"]
        end
    end

    %% Main flow
    Base64 -->|"POST /api/occurrences<br/>JSON payload"| API
    API --> Auth
    Auth --> BlobUpload
    BlobUpload --> GBIF
    GBIF --> Geocode
    Geocode --> BuildRecord
    BuildRecord -->|"agent createRecord"| PDS
    BuildRecord --> PrivateData
    PrivateData --> PrivData
    PDS --> URI
    URI -->|"Record broadcast"| Jetstream
    Jetstream --> Filter
    Filter -->|"JSON event stream"| WS
    WS --> Parse
    Parse --> Resolve
    Resolve --> Upsert
    Upsert --> Occurrences
    Upsert --> Observers
    WS -->|"Save cursor every 30s"| Cursor

    %% Response flow
    URI -.->|"Response: { uri, cid }"| API
    API -.->|"Response to frontend"| Modal
```

**Key insight:** All writes to lexicon-derived tables flow through the AT Protocol firehose. The appview writes the record on the user's PDS, then the ingester picks it up from Jetstream and writes the row. The appview holds no write grant on the `ingester` schema — this invariant is enforced at the database layer via role grants (see `20260418000000_appview_reader_grants.sql`).

**Visibility latency:** The appview does *not* do a direct-insert bypass for immediate visibility. Freshly created occurrences become queryable once the firehose event round-trips through Jetstream → ingester → DB (typically sub-second).

**Shared record processing:** Both the appview (when building a record) and the ingester (when indexing one) use the shared `observing_db::processing` module to convert AT Protocol record JSON into database params, ensuring consistent field mapping.

### Key Files

| Component | File |
|-----------|------|
| Create Modal | `frontend/src/components/modals/UploadModal.tsx` |
| Occurrence Routes | `crates/observing-appview/src/routes/occurrences/` |
| OAuth Routes | `crates/observing-appview/src/routes/oauth.rs` |
| Data Enrichment | `crates/observing-appview/src/enrichment.rs` |
| Firehose Client | `crates/jetstream-client/` |
| Ingester DB Ops | `crates/observing-ingester/src/database.rs` |
| Media Resolver | `crates/observing-ingester/src/media_resolver.rs` |
| Shared DB Layer | `crates/observing-db/src/` |
| Shared Record Processing | `crates/observing-db/src/processing.rs` |

### Data Transformations by Stage

| Stage | Input | Output | Transformation |
|-------|-------|--------|----------------|
| Frontend | User form input + files | JSON + Base64 images | Image encoding, form serialization |
| AppView | JSON request | AT Protocol record | Media record creation on PDS, GBIF lookup, geocoding, shared record processing |
| PDS | Record JSON | URI + CID | Cryptographic signing, storage |
| Jetstream | PDS events | Filtered JSON stream | Collection filtering |
| Ingester | JSON events | SQL statements | Media ref resolution, shared record processing, upsert |
| Database | SQL | Stored rows | PostGIS point encoding, indexing |

## Services

| Service | Port | Role | DB Role |
|---------|------|------|---------|
| **AppView** (`observing-appview`) | 3000 | REST API, OAuth, AT Protocol client, media cache, taxonomy, frontend static files | `appview_runtime` |
| **Ingester** (`observing-ingester`) | 8080 | Firehose consumer + backfill CLI | `ingester_runtime` |
| **Species-ID** (`observing-species-id`) | 3005 | BioCLIP photo → species inference | none |
| **Migrate** (`observing-migrate`) | — (one-shot Cloud Run Job) | Runs `sqlx` migrations before service deploys | `postgres` (admin) |

Media caching and GBIF/Wikidata taxonomy lookups are in-process inside the appview — there are no separate media-proxy or taxonomy services.

## Database Tables

Tables live in owner-labeled schemas (`ingester`, `appview`, `public`). Unqualified references resolve via a database-wide `search_path = ingester, appview, public`.

### Ingester-owned (schema `ingester`)

| Table | Description | Written By | Read By |
|-------|-------------|------------|---------|
| `occurrences` | Biodiversity observations | Ingester | AppView |
| `identifications` | Taxonomic determinations | Ingester | AppView |
| `comments` | Discussion on observations | Ingester | AppView |
| `likes` | Observation likes | Ingester | AppView |
| `interactions` | Species interactions | Ingester | AppView |
| `occurrence_observers` | Co-observer relationships | Ingester | AppView |
| `notifications` | Event notifications (ID / comment / like on your observation) | Ingester | AppView (SELECT + UPDATE on `read`) |
| `ingester_state` | Firehose cursor position | Ingester | Ingester, AppView (SELECT for diagnostics) |
| `community_ids` (matview) | Consensus taxonomy per occurrence | Ingester (REFRESH) | AppView |

### AppView-owned (schema `appview`)

| Table | Description | Written By | Read By |
|-------|-------------|------------|---------|
| `occurrence_private_data` | Exact coordinates (geoprivacy) | AppView | AppView |
| `notification_reads` | Per-user read-state for notifications | AppView | AppView |
| `oauth_sessions` | Persistent user sessions | AppView | AppView, Ingester (SELECT for `backfill --all`) |
| `oauth_state` | Temporary PKCE flow state | AppView | AppView |

### Shared reference (schema `public`)

| Table | Description | Written By | Read By |
|-------|-------------|------------|---------|
| `sensitive_species` | Auto-obscuration rules | (manual / migrations) | AppView, Ingester |
| `spatial_ref_sys` | PostGIS spatial reference systems | (PostGIS extension) | All |

## Data Lifecycles

### Creating an Observation

```
1. User fills form in frontend
   │
   ▼
2. Frontend POST /api/occurrences → AppView
   │
   ├─▶ Validate OAuth session
   ├─▶ Validate taxonomy (in-process GBIF + Wikidata)
   ├─▶ Reverse geocode coordinates (Nominatim)
   ├─▶ Upload each image as a bio.lexicons.temp.v0-1.media record on the user's PDS
   │
   ▼
3. AppView creates the bio.lexicons.temp.v0-1.occurrence record on the user's PDS
   │  createRecord({ collection: "bio.lexicons.temp.v0-1.occurrence",
   │                 record: { ..., associatedMedia: [ strongRefs ] } })
   │
   ├─▶ Writes exact coords to `appview.occurrence_private_data`
   │
   ▼
4. PDS emits event to Jetstream firehose
   │
   ▼
5. Ingester receives create event
   │
   ├─▶ Resolves associatedMedia strong refs → media records from author's PDS
   ├─▶ UPSERT to `ingester.occurrences`
   ├─▶ SYNC `ingester.occurrence_observers`
   │
   ▼
6. Data now queryable via API
```

### Adding an Identification

```
1. User submits ID in frontend
   │
   ▼
2. Frontend POST /api/identifications → AppView
   │
   ├─▶ Validate OAuth session
   ├─▶ Validate taxonomy
   │
   ▼
3. AppView creates AT Protocol record on user's PDS
   │  createRecord({ collection: "bio.lexicons.temp.v0-1.identification", ... })
   │
   ▼
4. PDS emits event to Jetstream firehose
   │
   ▼
5. Ingester receives create event
   │
   ├─▶ UPSERT to `ingester.identifications`
   ├─▶ INSERT into `ingester.notifications` (unless self-ID)
   │
   ▼
6. Community ID recalculated on next matview refresh
```

### Marking a Notification as Read

Notification creation is ingester-owned; read-state is appview-owned.

```
1. User views notifications → AppView SELECTs from
   ingester.notifications LEFT JOIN appview.notification_reads
   (produces the `read` flag).

2. User clicks "mark read" → AppView INSERTs into
   appview.notification_reads. No write to ingester schema.
```

### Firehose Ingestion

```
Jetstream WebSocket (wss://jetstream2.us-east.bsky.network/subscribe)
   │
   │  wanted_collections:
   │  - bio.lexicons.temp.v0-1.occurrence
   │  - bio.lexicons.temp.v0-1.identification
   │  - ing.observ.temp.comment
   │  - ing.observ.temp.interaction
   │  - ing.observ.temp.like
   │
   ▼
┌─────────────────────────────────────────────────────┐
│ Event: { did, time_us, commit: { op, collection,   │
│          rkey, record, cid } }                      │
└─────────────────────────────────────────────────────┘
   │
   ├─▶ op = "create" or "update" → UPSERT row
   ├─▶ op = "delete" → DELETE row (cascades)
   │
   ▼
Every 30 seconds: Save cursor to ingester.ingester_state
```

## Write Patterns by Service

### AppView writes

| Operation | Schema.Table | Trigger |
|-----------|--------------|---------|
| INSERT/UPDATE | `appview.oauth_state` | OAuth login flow |
| INSERT/UPDATE/DELETE | `appview.oauth_sessions` | Login / logout |
| INSERT/UPDATE | `appview.occurrence_private_data` | Create / update observation |
| INSERT | `appview.notification_reads` | User marks notification read |

The appview holds **no write grant** on the `ingester` schema — enforced at the DB layer.

### Ingester writes

| Operation | Schema.Table | Trigger |
|-----------|--------------|---------|
| UPSERT | `ingester.occurrences` | Firehose occurrence event |
| UPSERT | `ingester.identifications` | Firehose identification event |
| UPSERT | `ingester.comments` | Firehose comment event |
| UPSERT | `ingester.interactions` | Firehose interaction event |
| UPSERT | `ingester.likes` | Firehose like event |
| SYNC | `ingester.occurrence_observers` | Firehose occurrence with `recordedBy` |
| INSERT | `ingester.notifications` | On ID / comment / like where the actor ≠ occurrence owner |
| UPDATE | `ingester.ingester_state` | Every 30 seconds (cursor) |
| DELETE | `ingester.*` | Firehose delete event (cascades) |
| REFRESH | `ingester.community_ids` | Periodic matview refresh |

## Read Patterns

### Spatial Queries (PostGIS)

```sql
-- Nearby occurrences
SELECT * FROM occurrences
WHERE ST_DWithin(location, ST_MakePoint(lng, lat)::geography, radius_meters);

-- Bounding box for map
SELECT * FROM occurrences
WHERE location && ST_MakeEnvelope(minLng, minLat, maxLng, maxLat, 4326);
```

### Feed Queries

```sql
-- Recent observations
SELECT * FROM occurrences
ORDER BY indexed_at DESC
LIMIT 20;

-- User's observations
SELECT * FROM occurrences
WHERE did = 'did:plc:...'
ORDER BY event_date DESC;
```

### Community ID Calculation

```sql
-- Get consensus taxonomy for an occurrence
SELECT scientific_name, COUNT(*) as votes
FROM identifications
WHERE subject_uri = 'at://...'
GROUP BY scientific_name, kingdom
ORDER BY votes DESC
LIMIT 1;
```

## Geoprivacy

Exact coordinates are stored separately from public data:

| Table | Contains | Visibility |
|-------|----------|------------|
| `ingester.occurrences.location` | Potentially obscured point | Public |
| `appview.occurrence_private_data.location` | Exact coordinates | Owner + co-observers only |

Obscuration rules:
- `geoprivacy = 'open'` → Exact location in both tables
- `geoprivacy = 'obscured'` → Random offset in public, exact in private
- `geoprivacy = 'private'` → No public location
- Sensitive species → Auto-obscured based on `public.sensitive_species`

## Cascade Deletes

When an occurrence is deleted:

```
DELETE ingester.occurrences WHERE uri = '...'
  └─▶ CASCADE DELETE ingester.identifications WHERE subject_uri = '...'
  └─▶ CASCADE DELETE ingester.comments WHERE subject_uri = '...'
  └─▶ CASCADE DELETE ingester.likes WHERE subject_uri = '...'
  └─▶ CASCADE DELETE ingester.interactions WHERE subject_a/b_occurrence_uri = '...'
  └─▶ CASCADE DELETE ingester.occurrence_observers WHERE occurrence_uri = '...'
  └─▶ CASCADE DELETE appview.occurrence_private_data WHERE occurrence_uri = '...'
```

## Connection Details

All services use the same PostgreSQL instance, but connect as different Postgres roles:

```
Database: observing
Extensions: PostGIS
Connection pool: max 10

Environment variables (both services):
- DATABASE_URL (full connection string)
- or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD (Cloud SQL style)
```

**Migrations are not run by long-running services.** They're applied by a dedicated `observing-migrate` Cloud Run Job that runs pre-deploy in CI (see `.github/workflows/ci.yml`). The migrate Job is the only thing that ever connects as `postgres`.
