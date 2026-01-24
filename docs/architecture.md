# Architecture

## System Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│    AppView      │────▶│   PostgreSQL    │
│  (MapLibre GL)  │     │   (REST API)    │     │   + PostGIS     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │                         ▲
                              ▼                         │
                        ┌─────────────────┐             │
                        │  Media Proxy    │             │
                        │ (Image Cache)   │             │
                        └─────────────────┘             │
                                                        │
┌─────────────────┐     ┌─────────────────┐             │
│   User's PDS    │────▶│    Ingester     │─────────────┘
│ (bsky.social)   │     │  (Firehose)     │
└─────────────────┘     └─────────────────┘
```

## Package Structure

```
packages/
├── biosky-appview/     # REST API server (Express) + database, auth, types
├── biosky-ingester/    # AT Protocol firehose consumer (Rust)
├── biosky-media-proxy/ # Image caching proxy (Rust)
└── biosky-frontend/    # Web UI (Vite + MapLibre GL)
```

### Package Dependencies

```
biosky-appview (standalone TypeScript)
biosky-frontend (communicates with appview via REST)
biosky-media-proxy (standalone Rust binary)
biosky-ingester (standalone Rust binary)
```

## Components

### Lexicons (`lexicons/`)

Darwin Core compliant schemas for biodiversity data following [TDWG standards](https://dwc.tdwg.org/):

- `org.rwell.test.occurrence` - Occurrence records
- `org.rwell.test.identification` - Taxonomic determinations

### Ingester (`packages/biosky-ingester/`)

Rust service that monitors the AT Protocol firehose.

- **Firehose** - WebSocket client subscribing to the AT Protocol relay
- **Event Processing** - Handles occurrence and identification records
- **Built with** - Tokio, Axum, SQLx

### AppView (`packages/biosky-appview/`)

TypeScript REST API server.

- **REST API** - Geospatial queries, taxonomy search, community ID
- **Taxonomy Resolver** - Integrates GBIF and iNaturalist APIs
- **Community ID** - Consensus algorithm (2/3 majority)
- **Static Files** - Serves the built frontend

### Media Proxy (`packages/biosky-media-proxy/`)

Rust image caching service.

- **Image Cache** - Caches and proxies image blobs from PDS servers
- **Stateless** - No database, filesystem cache only

### Frontend (`packages/biosky-frontend/`)

Vite + React SPA.

- **Map** - MapLibre GL with clustered occurrence markers
- **Uploader** - Photo capture, EXIF extraction, occurrence submission
- **Identification** - Agree/Suggest ID interface

## Key Files

- `lexicons/` - AT Protocol lexicon definitions
- `packages/biosky-appview/src/database/` - PostgreSQL + PostGIS layer
- `packages/biosky-appview/src/auth/` - OAuth and identity resolution
- `packages/biosky-appview/src/generated/` - Generated TypeScript from lexicons
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
