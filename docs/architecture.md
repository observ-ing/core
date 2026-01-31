# Architecture

## System Overview

```mermaid
flowchart TB
    subgraph Client
        Frontend["Frontend<br/>(MapLibre GL)"]
    end

    subgraph Services
        AppView["AppView<br/>(OAuth, Static Files, RPC)"]
        API["API Service<br/>(REST API)"]
        MediaProxy["Media Proxy<br/>(Image Cache)"]
    end

    subgraph Data
        PostgreSQL["PostgreSQL<br/>+ PostGIS"]
    end

    subgraph Ingestion
        PDS["User's PDS<br/>(bsky.social)"]
        Ingester["Ingester<br/>(Firehose)"]
    end

    Frontend --> AppView
    Frontend --> API
    AppView --> PostgreSQL
    API --> PostgreSQL
    API -- "Internal RPC" --> AppView
    PDS --> Ingester
    Ingester --> PostgreSQL
```

## Project Structure

```
crates/
├── observing-ingester/    # AT Protocol firehose consumer (Rust)
├── observing-media-proxy/ # Image caching proxy (Rust)
└── observing-taxonomy/    # Taxonomy resolver service (Rust)

packages/
├── observing-api/         # REST API server (Express)
├── observing-appview/     # OAuth, static files, internal RPC (Express)
├── observing-frontend/    # Web UI (Vite + MapLibre GL)
└── observing-shared/      # Shared TypeScript types
```

### Package Dependencies

```
observing-api (TypeScript, calls appview for AT Protocol writes)
observing-appview (TypeScript, handles OAuth and PDS operations)
observing-frontend (communicates with api and appview via REST)
observing-media-proxy (standalone Rust binary)
observing-ingester (standalone Rust binary)
```

## Components

### Lexicons (`lexicons/`)

Darwin Core compliant schemas for biodiversity data following [TDWG standards](https://dwc.tdwg.org/):

- `org.rwell.test.occurrence` - Occurrence records
- `org.rwell.test.identification` - Taxonomic determinations

### Ingester (`crates/observing-ingester/`)

Rust service that monitors the AT Protocol firehose.

- **Firehose** - WebSocket client subscribing to the AT Protocol relay
- **Event Processing** - Handles occurrence and identification records
- **Built with** - Tokio, Axum, SQLx

### API Service (`packages/observing-api/`)

TypeScript REST API server handling read and write operations.

- **REST API** - Occurrences, identifications, comments, feeds, profiles, taxonomy
- **Internal RPC** - Calls AppView for AT Protocol write operations
- **Session Auth** - Verifies OAuth sessions from shared database
- **Data Enrichment** - Adds profile data and community IDs to responses

### AppView (`packages/observing-appview/`)

TypeScript server handling OAuth and AT Protocol operations.

- **OAuth** - AT Protocol authentication flow
- **Internal RPC** - Endpoints for blob upload, record create/update/delete
- **Static Files** - Serves the built frontend

### Media Proxy (`crates/observing-media-proxy/`)

Rust image caching service.

- **Image Cache** - Caches and proxies image blobs from PDS servers
- **Stateless** - No database, filesystem cache only

### Frontend (`packages/observing-frontend/`)

Vite + React SPA.

- **Map** - MapLibre GL with clustered occurrence markers
- **Uploader** - Photo capture, EXIF extraction, occurrence submission
- **Identification** - Agree/Suggest ID interface

## Key Files

- `lexicons/` - AT Protocol lexicon definitions
- `packages/observing-api/src/routes/` - REST API endpoint handlers
- `packages/observing-api/src/internal-client.ts` - RPC client for AppView
- `packages/observing-appview/src/database/` - PostgreSQL + PostGIS layer
- `packages/observing-appview/src/auth/` - OAuth and identity resolution
- `packages/observing-appview/src/generated/` - Generated TypeScript from lexicons
- `scripts/generate-types.js` - Lexicon → TypeScript generator
- `cloudbuild.yaml` - Multi-service Cloud Build config

## Community Identification

Consensus algorithm similar to iNaturalist:

- **Research Grade**: 2+ identifications with 2/3 majority on species
- **Needs ID**: Has identifications but no consensus
- **Casual**: No identifications yet

Calculated in real-time, stored in a materialized view.

## Data Ownership

Unlike centralized platforms, data is stored on users' Personal Data Servers (PDS):

- **Your data, your server** - Observations are AT Protocol records you control
- **Portable** - Move your data between PDS providers
- **Interoperable** - Darwin Core standards for scientific use
- **Federated** - No single point of failure
