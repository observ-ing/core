# BioSky

A decentralized biodiversity observation platform built on the AT Protocol (atproto). Think iNaturalist, but federated.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│    AppView      │────▶│   PostgreSQL    │
│  (MapLibre GL)  │     │   (REST API)    │     │   + PostGIS     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         ▲
                                                         │
┌─────────────────┐     ┌─────────────────┐              │
│   User's PDS    │────▶│    Ingester     │──────────────┘
│ (bsky.social)   │     │  (Firehose)     │
└─────────────────┘     └─────────────────┘
```

## Components

### Lexicons (`lexicons/`)

Darwin Core compliant schemas for biodiversity data:

- `net.inat.observation` - Observation records with location, date, species, and photos
- `net.inat.identification` - Community identifications for observations

### Ingester (`src/ingester/`)

- **Firehose** - WebSocket client that subscribes to the AT Protocol relay
- **Database** - PostgreSQL with PostGIS for spatial queries
- **Media Proxy** - Caches and proxies image blobs from PDS servers

### AppView (`src/appview/`)

- **REST API** - Geospatial queries, taxonomy search, community ID calculation
- **Taxonomy Resolver** - Integrates GBIF and iNaturalist APIs
- **Community ID** - Consensus algorithm for species identification

### Auth (`src/auth/`)

- **OAuth** - AT Protocol OAuth 2.0 client
- **Identity** - Handle/DID resolution and profile fetching

### Frontend (`src/frontend/`)

- **Map** - MapLibre GL map with clustered observation markers
- **Uploader** - Photo capture, EXIF extraction, observation submission
- **Identification** - Agree/Suggest ID interface

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL with PostGIS extension
- A local PDS for testing (optional)

### Installation

```bash
npm install
```

### Database Setup

```bash
# Create database
createdb biosky

# Enable PostGIS
psql biosky -c "CREATE EXTENSION postgis;"

# Run migrations (handled automatically on first run)
```

### Configuration

```bash
# Environment variables
export DATABASE_URL="postgresql://localhost:5432/biosky"
export RELAY_URL="wss://bsky.network"
export PORT=3000
```

### Running

```bash
# Start the ingester (monitors firehose)
npm run ingester

# Start the AppView API server
npm run appview

# Start the media proxy
npm run media-proxy

# Start the frontend dev server
npm run frontend:dev
```

### Testing Record Publishing

```bash
# Publish a test observation to a PDS
PDS_URL=http://localhost:2583 \
HANDLE=test.local \
PASSWORD=password \
npm run test:publish
```

## Lexicon Schemas

### net.inat.observation

```json
{
  "scientificName": "Eschscholzia californica",
  "eventDate": "2024-01-15T10:30:00Z",
  "location": {
    "decimalLatitude": 37.7749,
    "decimalLongitude": -122.4194,
    "coordinateUncertaintyInMeters": 10,
    "geodeticDatum": "WGS84"
  },
  "verbatimLocality": "Golden Gate Park, San Francisco",
  "blobs": [
    {
      "image": { "$type": "blob", ... },
      "alt": "Orange California Poppy flower"
    }
  ],
  "notes": "Multiple individuals blooming along the trail",
  "createdAt": "2024-01-15T10:35:00Z"
}
```

### net.inat.identification

```json
{
  "subject": {
    "uri": "at://did:plc:abc.../net.inat.observation/123",
    "cid": "bafyrei..."
  },
  "taxonName": "Eschscholzia californica",
  "taxonRank": "species",
  "comment": "Distinctive orange petals and feathery leaves",
  "isAgreement": false,
  "confidence": "high",
  "createdAt": "2024-01-15T11:00:00Z"
}
```

## API Endpoints

### Observations

- `GET /api/observations/nearby?lat=37.77&lng=-122.41&radius=10000`
- `GET /api/observations/bbox?minLat=...&minLng=...&maxLat=...&maxLng=...`
- `GET /api/observations/geojson?minLat=...` (for map clustering)
- `GET /api/observations/:uri`

### Identifications

- `GET /api/identifications/:observationUri`

### Taxonomy

- `GET /api/taxa/search?q=eschscholzia`
- `GET /api/taxa/validate?name=Eschscholzia%20californica`

### Auth

- `GET /oauth/login?handle=user.bsky.social`
- `GET /oauth/callback`
- `POST /oauth/logout`
- `GET /oauth/me`

## License

MIT
