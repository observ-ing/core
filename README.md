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

Darwin Core compliant schemas for biodiversity data following [TDWG standards](https://dwc.tdwg.org/):

- `net.inat.occurrence` - Occurrence records following the [Darwin Core Occurrence class](https://dwc.tdwg.org/terms/#occurrence)
- `net.inat.identification` - Taxonomic determinations following the [Darwin Core Identification class](https://dwc.tdwg.org/terms/#identification)

### Ingester (`src/ingester/`)

- **Firehose** - WebSocket client that subscribes to the AT Protocol relay
- **Database** - PostgreSQL with PostGIS for spatial queries
- **Media Proxy** - Caches and proxies image blobs from PDS servers

### AppView (`src/appview/`)

- **REST API** - Geospatial queries, taxonomy search, community ID calculation
- **Taxonomy Resolver** - Integrates GBIF and iNaturalist APIs
- **Community ID** - Consensus algorithm for species identification (2/3 majority)

### Auth (`src/auth/`)

- **OAuth** - AT Protocol OAuth 2.0 client
- **Identity** - Handle/DID resolution and profile fetching

### Frontend (`src/frontend/`)

- **Map** - MapLibre GL map with clustered occurrence markers
- **Uploader** - Photo capture, EXIF extraction, occurrence submission
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
# Using Docker with PostGIS
docker run --name biosky-postgres \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -p 5432:5432 \
  -d postgis/postgis

# Create database
docker exec -it biosky-postgres createdb -U postgres biosky

# Enable PostGIS (handled automatically by migrations)
```

### Configuration

```bash
# Environment variables
export DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/biosky"
export RELAY_URL="wss://bsky.network"
export PORT=3000
```

### Running

```bash
# Start the ingester (monitors firehose)
npm run ingester

# Start the AppView API server
npm run appview

# Start the frontend dev server
npm run frontend:dev
```

### Testing Record Publishing

```bash
# Publish a test occurrence to a PDS
PDS_URL=https://bsky.social \
HANDLE=yourhandle.bsky.social \
PASSWORD=your-app-password \
npx tsx scripts/publish-occurrence.ts
```

## Darwin Core Lexicon Schemas

BioSky uses [Darwin Core](https://dwc.tdwg.org/) terminology for biodiversity data interoperability.

### net.inat.occurrence

An occurrence is "an existence of an Organism at a particular place at a particular time" (dwc:Occurrence).

```json
{
  "basisOfRecord": "HumanObservation",
  "scientificName": "Eschscholzia californica",
  "eventDate": "2024-01-15T10:30:00Z",
  "location": {
    "decimalLatitude": 37.7749,
    "decimalLongitude": -122.4194,
    "coordinateUncertaintyInMeters": 10,
    "geodeticDatum": "WGS84",
    "countryCode": "US",
    "stateProvince": "California"
  },
  "verbatimLocality": "Golden Gate Park, San Francisco",
  "habitat": "Grassland along hiking trail",
  "occurrenceStatus": "present",
  "occurrenceRemarks": "Multiple individuals blooming along the trail",
  "individualCount": 5,
  "lifeStage": "flowering",
  "associatedMedia": [
    {
      "image": { "$type": "blob", "ref": "...", "mimeType": "image/jpeg" },
      "alt": "Orange California Poppy flower"
    }
  ],
  "createdAt": "2024-01-15T10:35:00Z"
}
```

#### Darwin Core Fields

| Field | Darwin Core Term | Description |
|-------|------------------|-------------|
| `basisOfRecord` | dwc:basisOfRecord | The nature of the record (HumanObservation, MachineObservation, etc.) |
| `scientificName` | dwc:scientificName | Full scientific name with authorship if known |
| `eventDate` | dwc:eventDate | Date-time of the occurrence (ISO 8601) |
| `decimalLatitude` | dwc:decimalLatitude | Geographic latitude in decimal degrees |
| `decimalLongitude` | dwc:decimalLongitude | Geographic longitude in decimal degrees |
| `coordinateUncertaintyInMeters` | dwc:coordinateUncertaintyInMeters | Uncertainty radius in meters |
| `verbatimLocality` | dwc:verbatimLocality | Original textual description of the place |
| `habitat` | dwc:habitat | Habitat description |
| `occurrenceStatus` | dwc:occurrenceStatus | Presence or absence (present/absent) |
| `occurrenceRemarks` | dwc:occurrenceRemarks | Notes about the occurrence |
| `individualCount` | dwc:individualCount | Number of individuals |
| `sex` | dwc:sex | Sex of the organism |
| `lifeStage` | dwc:lifeStage | Age class or life stage |
| `behavior` | dwc:behavior | Observed behavior |
| `establishmentMeans` | dwc:establishmentMeans | How organism came to be there (native/introduced) |

### net.inat.identification

A taxonomic determination (dwc:Identification) for an occurrence.

```json
{
  "subject": {
    "uri": "at://did:plc:abc.../net.inat.occurrence/123",
    "cid": "bafyrei..."
  },
  "scientificName": "Eschscholzia californica",
  "taxonRank": "species",
  "identificationQualifier": "cf.",
  "taxonID": "https://www.gbif.org/species/3084923",
  "identificationRemarks": "Distinctive orange petals and feathery leaves",
  "identificationVerificationStatus": "verified",
  "isAgreement": false,
  "dateIdentified": "2024-01-15T11:00:00Z"
}
```

#### Darwin Core Fields

| Field | Darwin Core Term | Description |
|-------|------------------|-------------|
| `scientificName` | dwc:scientificName | The scientific name being proposed |
| `taxonRank` | dwc:taxonRank | Taxonomic rank (species, genus, family, etc.) |
| `identificationQualifier` | dwc:identificationQualifier | Qualifier like "cf." or "aff." |
| `taxonID` | dwc:taxonID | URI to taxonomic authority (GBIF, iNaturalist) |
| `identificationRemarks` | dwc:identificationRemarks | Notes about the identification |
| `identificationVerificationStatus` | dwc:identificationVerificationStatus | Verification status |
| `dateIdentified` | dwc:dateIdentified | Date the identification was made |

## API Endpoints

### Occurrences

- `GET /api/occurrences/nearby?lat=37.77&lng=-122.41&radius=10000`
- `GET /api/occurrences/bbox?minLat=...&minLng=...&maxLat=...&maxLng=...`
- `GET /api/occurrences/geojson?minLat=...` (for map clustering)
- `GET /api/occurrences/:uri`

### Identifications

- `GET /api/identifications/:occurrenceUri`

### Taxonomy

- `GET /api/taxa/search?q=eschscholzia`
- `GET /api/taxa/validate?name=Eschscholzia%20californica`

### Auth

- `GET /oauth/login?handle=user.bsky.social`
- `GET /oauth/callback`
- `POST /oauth/logout`
- `GET /oauth/me`

## Community Identification

BioSky implements a community consensus algorithm similar to iNaturalist:

- **Research Grade**: 2+ identifications with 2/3 majority agreeing on species
- **Needs ID**: Has identifications but no consensus
- **Casual**: No identifications yet

The community ID is calculated in real-time and stored in a materialized view for performance.

## Data Ownership

Unlike centralized platforms, BioSky data is stored on users' Personal Data Servers (PDS):

- **Your data, your server**: Observations are AT Protocol records you control
- **Portable**: Move your data between PDS providers anytime
- **Interoperable**: Data follows Darwin Core standards for scientific use
- **Federated**: No single point of failure or control

## License

MIT
