# Darwin Core Lexicons

BioSky uses [Darwin Core](https://dwc.tdwg.org/) terminology for biodiversity data interoperability.

## org.rwell.test.occurrence

An occurrence is "an existence of an Organism at a particular place at a particular time" (dwc:Occurrence).

### Example

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

### Fields

| Field | Darwin Core Term | Description |
|-------|------------------|-------------|
| `basisOfRecord` | dwc:basisOfRecord | Nature of the record (HumanObservation, MachineObservation) |
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

## org.rwell.test.identification

A taxonomic determination (dwc:Identification) for an occurrence.

### Example

```json
{
  "subject": {
    "uri": "at://did:plc:abc.../org.rwell.test.occurrence/123",
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

### Fields

| Field | Darwin Core Term | Description |
|-------|------------------|-------------|
| `scientificName` | dwc:scientificName | The scientific name being proposed |
| `taxonRank` | dwc:taxonRank | Taxonomic rank (species, genus, family) |
| `identificationQualifier` | dwc:identificationQualifier | Qualifier like "cf." or "aff." |
| `taxonID` | dwc:taxonID | URI to taxonomic authority (GBIF, iNaturalist) |
| `identificationRemarks` | dwc:identificationRemarks | Notes about the identification |
| `identificationVerificationStatus` | dwc:identificationVerificationStatus | Verification status |
| `dateIdentified` | dwc:dateIdentified | Date the identification was made |

## References

- [Darwin Core Quick Reference](https://dwc.tdwg.org/terms/)
- [Darwin Core Occurrence](https://dwc.tdwg.org/terms/#occurrence)
- [Darwin Core Identification](https://dwc.tdwg.org/terms/#identification)
