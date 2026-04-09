# Darwin Core Lexicons

Observ.ing uses [Darwin Core](https://dwc.tdwg.org/) terminology for biodiversity data interoperability. Fields marked with ✅ are implemented, ⚠️ are partially implemented or mapped differently, and ❌ are not yet implemented.

## bio.lexicons.temp.occurrence

An occurrence is "an existence of an Organism at a particular place at a particular time" (dwc:Occurrence).

### Example

```json
{
  "eventDate": "2024-01-15T10:30:00Z",
  "location": {
    "decimalLatitude": "37.7749",
    "decimalLongitude": "-122.4194",
    "coordinateUncertaintyInMeters": 10,
    "geodeticDatum": "WGS84",
    "continent": "North America",
    "country": "United States",
    "countryCode": "US",
    "stateProvince": "California",
    "county": "San Francisco",
    "locality": "Golden Gate Park"
  },
  "verbatimLocality": "Golden Gate Park, San Francisco",
  "notes": "Multiple individuals blooming along the trail",
  "blobs": [
    {
      "image": { "$type": "blob", "ref": "...", "mimeType": "image/jpeg" },
      "alt": "Orange California Poppy flower"
    }
  ],
  "license": "CC-BY-4.0",
  "createdAt": "2024-01-15T10:35:00Z"
}
```

> **Note:** Taxonomy fields are not part of the occurrence record. Species identification is provided via separate `bio.lexicons.temp.identification` records, which allows users to submit observations without knowing the species and enables community identification.

### Fields

| Observ.ing Field | GBIF / Darwin Core | Status | Description |
|--------------|-------------------|--------|-------------|
| `eventDate` | dwc:eventDate | ✅ | Date-time of the occurrence (ISO 8601) |
| `location.decimalLatitude` | dwc:decimalLatitude | ✅ | Geographic latitude in decimal degrees (stored as string) |
| `location.decimalLongitude` | dwc:decimalLongitude | ✅ | Geographic longitude in decimal degrees (stored as string) |
| `location.coordinateUncertaintyInMeters` | dwc:coordinateUncertaintyInMeters | ✅ | Uncertainty radius in meters |
| `location.geodeticDatum` | dwc:geodeticDatum | ✅ | Spatial reference system (defaults to WGS84) |
| `location.continent` | dwc:continent | ✅ | Continent name |
| `location.country` | dwc:country | ✅ | Country name |
| `location.countryCode` | dwc:countryCode | ✅ | ISO 3166-1 alpha-2 country code |
| `location.stateProvince` | dwc:stateProvince | ✅ | State/province name |
| `location.county` | dwc:county | ✅ | County name |
| `location.municipality` | dwc:municipality | ✅ | Municipality name |
| `location.locality` | dwc:locality | ✅ | Specific locality description |
| `location.waterBody` | dwc:waterBody | ✅ | Name of water body |
| `location.minimumElevationInMeters` | dwc:minimumElevationInMeters | ✅ | Lower elevation bound |
| `location.maximumElevationInMeters` | dwc:maximumElevationInMeters | ✅ | Upper elevation bound |
| `location.minimumDepthInMeters` | dwc:minimumDepthInMeters | ✅ | Lower depth bound |
| `location.maximumDepthInMeters` | dwc:maximumDepthInMeters | ✅ | Upper depth bound |
| `verbatimLocality` | dwc:verbatimLocality | ✅ | Original textual description of the place |
| `notes` | dwc:occurrenceRemarks | ✅ | Notes about the occurrence |
| `blobs` | dwc:associatedMedia | ✅ | Array of image references |
| `license` | dcterms:license | ✅ | SPDX identifiers (CC0, CC-BY, etc.) |
| `createdAt` | — | ✅ | Record creation timestamp (Observ.ing-specific) |
| (AT Protocol URI) | dwc:occurrenceID | ⚠️ | `at://did:plc:.../bio.lexicons.temp.occurrence/...` |
| (DID) | dwc:recordedBy | ⚠️ | Derived from AT Protocol identity |
| — | dwc:basisOfRecord | ❌ | Always assumed `HumanObservation` |
| — | dwc:occurrenceStatus | ❌ | Always assumed `present` |
| — | dwc:individualCount | ❌ | Number of individuals observed |
| — | dwc:sex | ❌ | Sex of the organism |
| — | dwc:lifeStage | ❌ | Age class or life stage |
| — | dwc:behavior | ❌ | Observed behavior |
| — | dwc:reproductiveCondition | ❌ | Reproductive condition (flowering, fruiting, etc.) |
| — | dwc:establishmentMeans | ❌ | Native, introduced, invasive, etc. |
| — | dwc:degreeOfEstablishment | ❌ | Degree of establishment in location |
| — | dwc:pathway | ❌ | Means of introduction |
| — | dwc:habitat | ❌ | Habitat description |
| — | dwc:samplingProtocol | ❌ | Method used for sampling |
| — | dwc:samplingEffort | ❌ | Effort expended during sampling |
| — | dwc:eventRemarks | ❌ | Notes about the sampling event |

## bio.lexicons.temp.identification

A taxonomic determination (dwc:Identification) for an occurrence. Uses the upstream [lexicons.bio](https://github.com/lexicons-bio/lexicons.bio) schema with flat fields (no nested taxon object). App-specific fields (`subjectIndex`, `isAgreement`, `createdAt`) are stored as extra JSON fields in the AT Protocol record.

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
  "subjectIndex": 0,
  "isAgreement": false,
  "createdAt": "2024-01-15T11:00:00Z"
}
```

### Fields

| Observ.ing Field | GBIF / Darwin Core | Status | Description |
|--------------|-------------------|--------|-------------|
| `occurrence` | — | ✅ | AT Protocol strong reference to the occurrence |
| `scientificName` | dwc:scientificName | ✅ | The full scientific name, with authorship if known |
| `taxonRank` | dwc:taxonRank | ✅ | Taxonomic rank (species, genus, family) |
| `kingdom` | dwc:kingdom | ✅ | Taxonomic kingdom (for homonym disambiguation) |
| `identificationRemarks` | dwc:identificationRemarks | ✅ | Notes about the identification |
| `subjectIndex` | — | ✅ | Index when multiple organisms in one observation (app-specific) |
| `isAgreement` | — | ✅ | Whether ID agrees with community consensus (app-specific) |
| `createdAt` | dwc:dateIdentified | ✅ | Date the identification was made (app-specific) |
| (AT Protocol URI) | dwc:identificationID | ⚠️ | AT URI serves as identifier |
| (DID) | dwc:identifiedBy | ⚠️ | Derived from AT Protocol identity |
| — | dwc:identificationQualifier | ❌ | Qualifier like "cf." or "aff." |
| — | dwc:identificationVerificationStatus | ❌ | Verification status |
| — | dwc:identificationReferences | ❌ | References used for identification |
| — | dwc:typeStatus | ❌ | Type specimen status |

## References

- [Darwin Core Quick Reference](https://dwc.tdwg.org/terms/)
- [Darwin Core Occurrence](https://dwc.tdwg.org/terms/#occurrence)
- [Darwin Core Identification](https://dwc.tdwg.org/list/#identification)
- [Darwin Core Taxon](https://dwc.tdwg.org/list/#taxon)
- [GBIF Identification History Extension](https://rs.gbif.org/extension/dwc/identification.xml)
- [GBIF Occurrence Download Fields](https://www.gbif.org/developer/occurrence)
