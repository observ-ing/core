# Darwin Core Lexicons

BioSky uses [Darwin Core](https://dwc.tdwg.org/) terminology for biodiversity data interoperability. Fields marked with ✅ are implemented, ⚠️ are partially implemented or mapped differently, and ❌ are not yet implemented.

## org.rwell.test.occurrence

An occurrence is "an existence of an Organism at a particular place at a particular time" (dwc:Occurrence).

### Example

```json
{
  "scientificName": "Eschscholzia californica",
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
  "taxonId": "gbif:3084746",
  "taxonRank": "species",
  "vernacularName": "California Poppy",
  "kingdom": "Plantae",
  "phylum": "Tracheophyta",
  "class": "Magnoliopsida",
  "order": "Ranunculales",
  "family": "Papaveraceae",
  "genus": "Eschscholzia",
  "createdAt": "2024-01-15T10:35:00Z"
}
```

### Fields

| BioSky Field | GBIF / Darwin Core | Status | Description |
|--------------|-------------------|--------|-------------|
| `scientificName` | dwc:scientificName | ✅ | Full scientific name with authorship if known |
| `eventDate` | dwc:eventDate | ✅ | Date-time of the occurrence (ISO 8601) |
| `location.decimalLatitude` | dwc:decimalLatitude | ✅ | Geographic latitude in decimal degrees (stored as string) |
| `location.decimalLongitude` | dwc:decimalLongitude | ✅ | Geographic longitude in decimal degrees (stored as string) |
| `location.coordinateUncertaintyInMeters` | dwc:coordinateUncertaintyInMeters | ✅ | Uncertainty radius in meters |
| `location.geodeticDatum` | dwc:geodeticDatum | ✅ | Spatial reference system (defaults to WGS84) |
| `verbatimLocality` | dwc:verbatimLocality | ✅ | Original textual description of the place |
| `notes` | dwc:occurrenceRemarks | ✅ | Notes about the occurrence |
| `blobs` | dwc:associatedMedia | ✅ | Array of image references |
| `license` | dcterms:license | ✅ | SPDX identifiers (CC0, CC-BY, etc.) |
| `createdAt` | — | ✅ | Record creation timestamp (BioSky-specific) |
| (AT Protocol URI) | dwc:occurrenceID | ⚠️ | `at://did:plc:.../org.rwell.test.occurrence/...` |
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
| `kingdom` | dwc:kingdom | ✅ | Taxonomic kingdom |
| `phylum` | dwc:phylum | ✅ | Taxonomic phylum |
| `class` | dwc:class | ✅ | Taxonomic class |
| `order` | dwc:order | ✅ | Taxonomic order |
| `family` | dwc:family | ✅ | Taxonomic family |
| `genus` | dwc:genus | ✅ | Taxonomic genus |
| — | dwc:specificEpithet | ❌ | Species epithet |
| — | dwc:infraspecificEpithet | ❌ | Subspecies/variety epithet |
| `vernacularName` | dwc:vernacularName | ✅ | Common name |
| `taxonId` | dwc:taxonID | ✅ | External taxon identifier (e.g., gbif:2878688) |
| `taxonRank` | dwc:taxonRank | ✅ | Taxonomic rank (species, genus, family, etc.) |
| — | dwc:samplingProtocol | ❌ | Method used for sampling |
| — | dwc:samplingEffort | ❌ | Effort expended during sampling |
| — | dwc:eventRemarks | ❌ | Notes about the sampling event |

## org.rwell.test.identification

A taxonomic determination (dwc:Identification) for an occurrence.

### Example

```json
{
  "subject": {
    "uri": "at://did:plc:abc.../org.rwell.test.occurrence/123",
    "cid": "bafyrei..."
  },
  "taxonName": "Eschscholzia californica",
  "taxonRank": "species",
  "taxonId": "gbif:3084746",
  "vernacularName": "California Poppy",
  "kingdom": "Plantae",
  "phylum": "Tracheophyta",
  "class": "Magnoliopsida",
  "order": "Ranunculales",
  "family": "Papaveraceae",
  "genus": "Eschscholzia",
  "comment": "Distinctive orange petals and feathery leaves",
  "isAgreement": false,
  "confidence": "high",
  "createdAt": "2024-01-15T11:00:00Z"
}
```

### Fields

| BioSky Field | GBIF / Darwin Core | Status | Description |
|--------------|-------------------|--------|-------------|
| `taxonName` | dwc:scientificName | ✅ | The scientific name being proposed |
| `taxonRank` | dwc:taxonRank | ✅ | Taxonomic rank (species, genus, family) |
| `comment` | dwc:identificationRemarks | ✅ | Notes about the identification |
| `createdAt` | dwc:dateIdentified | ✅ | Date the identification was made |
| `subject` | — | ✅ | AT Protocol strong reference to the occurrence (BioSky-specific) |
| `subjectIndex` | — | ✅ | Index when multiple organisms in one observation (BioSky-specific) |
| `isAgreement` | — | ✅ | Whether ID agrees with community consensus (BioSky-specific) |
| `confidence` | — | ✅ | Identifier's confidence level: low/medium/high (BioSky-specific) |
| (AT Protocol URI) | dwc:identificationID | ⚠️ | AT URI serves as identifier |
| (DID) | dwc:identifiedBy | ⚠️ | Derived from AT Protocol identity |
| — | dwc:identificationQualifier | ❌ | Qualifier like "cf." or "aff." |
| `taxonId` | dwc:taxonID | ✅ | External taxon ID (e.g., gbif:2878688) |
| — | dwc:scientificNameAuthorship | ❌ | Authorship of the scientific name |
| — | dwc:identificationVerificationStatus | ❌ | Verification status |
| — | dwc:identificationReferences | ❌ | References used for identification |
| — | dwc:typeStatus | ❌ | Type specimen status |
| `kingdom` | dwc:kingdom | ✅ | Taxonomic kingdom |
| `phylum` | dwc:phylum | ✅ | Taxonomic phylum |
| `class` | dwc:class | ✅ | Taxonomic class |
| `order` | dwc:order | ✅ | Taxonomic order |
| `family` | dwc:family | ✅ | Taxonomic family |
| `genus` | dwc:genus | ✅ | Taxonomic genus |
| `vernacularName` | dwc:vernacularName | ✅ | Common name |

## References

- [Darwin Core Quick Reference](https://dwc.tdwg.org/terms/)
- [Darwin Core Occurrence](https://dwc.tdwg.org/terms/#occurrence)
- [Darwin Core Identification](https://dwc.tdwg.org/terms/#identification)
- [GBIF Occurrence Download Fields](https://www.gbif.org/developer/occurrence)
