# Darwin Core Lexicons

Observ.ing uses [Darwin Core](https://dwc.tdwg.org/) terminology for biodiversity data interoperability. This document describes the **current** shape of each lexicon record. A section at the bottom lists Darwin Core terms we may adopt later.

For the full, authoritative schema definitions, see the JSON files under `lexicons/bio/lexicons/temp/`.

## bio.lexicons.temp.occurrence

An occurrence is "an existence of an Organism at a particular place at a particular time" (dwc:Occurrence). The schema is intentionally minimal today — most Darwin Core location refinements are deferred to future extensions.

### Example

```json
{
  "eventDate": "2024-01-15T10:30:00Z",
  "decimalLatitude": "37.7749",
  "decimalLongitude": "-122.4194",
  "coordinateUncertaintyInMeters": 10,
  "associatedMedia": [
    {
      "uri": "at://did:plc:abc.../bio.lexicons.temp.media/3kabc...",
      "cid": "bafyrei..."
    }
  ]
}
```

### Fields

| Field | Darwin Core | Description |
|-------|-------------|-------------|
| `eventDate` | dwc:eventDate | Date-time of the occurrence (ISO 8601) |
| `decimalLatitude` | dwc:decimalLatitude | Latitude in decimal degrees (stored as string; range -90..90) |
| `decimalLongitude` | dwc:decimalLongitude | Longitude in decimal degrees (stored as string; range -180..180) |
| `coordinateUncertaintyInMeters` | dwc:coordinateUncertaintyInMeters | Uncertainty radius in meters |
| `associatedMedia` | dwc:associatedMedia | Array of AT Protocol strong refs to `bio.lexicons.temp.media` records (max 10) |
| (AT URI) | dwc:occurrenceID | `at://did:plc:.../bio.lexicons.temp.occurrence/...` — derived, not stored |
| (DID) | dwc:recordedBy | Derived from AT Protocol identity |

> **Taxonomy is not part of the occurrence record.** Species identifications live in separate `bio.lexicons.temp.identification` records, which lets users submit observations without knowing the species and enables community identification.

## bio.lexicons.temp.media

An image record referenced from occurrences. Media records are created by users but are **not firehose-indexed** by the ingester — the ingester resolves them on demand when processing occurrences that reference them.

### Example

```json
{
  "image": { "$type": "blob", "ref": { "$link": "bafkrei..." }, "mimeType": "image/jpeg", "size": 842103 },
  "alt": "Orange California Poppy flower along a trail",
  "aspectRatio": { "width": 4032, "height": 3024 },
  "license": "CC-BY-4.0"
}
```

### Fields

| Field | Darwin Core / Dublin Core | Description |
|-------|---------------------------|-------------|
| `image` | — | Image blob ref (jpeg/png/webp, ≤10 MB). Required. |
| `alt` | — | Alt text for accessibility (≤1000 chars) |
| `aspectRatio` | — | `{ width, height }` in pixels, used for layout before load |
| `license` | dcterms:license | SPDX identifier: `CC0-1.0`, `CC-BY-4.0`, `CC-BY-NC-4.0`, `CC-BY-SA-4.0`, `CC-BY-NC-SA-4.0` |

## bio.lexicons.temp.identification

A taxonomic determination (dwc:Identification) attached to an occurrence via strong ref.

### Example

```json
{
  "occurrence": {
    "uri": "at://did:plc:abc.../bio.lexicons.temp.occurrence/123",
    "cid": "bafyrei..."
  },
  "scientificName": "Eschscholzia californica Cham.",
  "taxonRank": "species",
  "kingdom": "Plantae",
  "identificationRemarks": "Matches the characteristic orange petals and finely dissected leaves.",
  "isAgreement": false,
  "createdAt": "2024-01-15T11:00:00Z"
}
```

### Fields

| Field | Darwin Core | Description |
|-------|-------------|-------------|
| `occurrence` | — | AT Protocol strong ref to the occurrence being identified. Required. |
| `scientificName` | dwc:scientificName | Full scientific name with authorship if known. Required. (≤256 chars) |
| `taxonRank` | dwc:taxonRank | One of: `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species`, `subspecies`, `variety`, `form`. Defaults to `species`. |
| `kingdom` | dwc:kingdom | Taxonomic kingdom, used for homonym disambiguation |
| `identificationRemarks` | dwc:identificationRemarks | Reasoning for this identification (≤3000 chars) |
| (AT URI) | dwc:identificationID | Derived from AT URI |
| (DID) | dwc:identifiedBy | Derived from AT Protocol identity |

### App-specific fields (schema drift)

The appview writes two extra JSON fields into identification records that are **not declared in the upstream `lexicons.bio` schema**:

| Field | Purpose |
|-------|---------|
| `isAgreement` | Whether this ID agrees with the current community consensus. Surfaces as an "Agree" vs "Suggest" action in the UI. |
| `createdAt` | Client-set creation timestamp (distinct from the AT Protocol commit time). |

> **Interop caveat.** Third-party consumers of these records via AT Protocol will see `isAgreement` and `createdAt` as extra JSON but won't have them in their generated types. If/when `lexicons.bio` adds equivalent fields upstream we should align on their names.

## Planned Darwin Core extensions

Terms we may adopt later on the occurrence record, grouped by the kind of information they carry. None are currently in the lexicon.

**Location refinements** (currently only lat/lng + uncertainty):
`dwc:geodeticDatum`, `dwc:continent`, `dwc:country`, `dwc:countryCode`, `dwc:stateProvince`, `dwc:county`, `dwc:municipality`, `dwc:locality`, `dwc:verbatimLocality`, `dwc:waterBody`, `dwc:minimumElevationInMeters`, `dwc:maximumElevationInMeters`, `dwc:minimumDepthInMeters`, `dwc:maximumDepthInMeters`.

**Occurrence context:**
`dwc:basisOfRecord` (assumed `HumanObservation`), `dwc:occurrenceStatus` (assumed `present`), `dwc:occurrenceRemarks`, `dwc:individualCount`, `dwc:sex`, `dwc:lifeStage`, `dwc:behavior`, `dwc:reproductiveCondition`.

**Establishment / invasiveness:**
`dwc:establishmentMeans`, `dwc:degreeOfEstablishment`, `dwc:pathway`.

**Sampling event:**
`dwc:habitat`, `dwc:samplingProtocol`, `dwc:samplingEffort`, `dwc:eventRemarks`.

On identification:
`dwc:identificationQualifier` (cf./aff.), `dwc:identificationVerificationStatus`, `dwc:identificationReferences`, `dwc:typeStatus`, `dwc:dateIdentified` (currently overlaps with app-specific `createdAt`).

## References

- [Darwin Core Quick Reference](https://dwc.tdwg.org/terms/)
- [Darwin Core Occurrence](https://dwc.tdwg.org/terms/#occurrence)
- [Darwin Core Identification](https://dwc.tdwg.org/list/#identification)
- [Darwin Core Taxon](https://dwc.tdwg.org/list/#taxon)
- [GBIF Identification History Extension](https://rs.gbif.org/extension/dwc/identification.xml)
- [GBIF Occurrence Download Fields](https://www.gbif.org/developer/occurrence)
