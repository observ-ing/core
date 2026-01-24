# Darwin Core Alignment Roadmap

This document tracks planned improvements to align BioSky more closely with the [Darwin Core Conceptual Model (DwC-CM)](https://gbif.github.io/dwc-dp/#cm) and [Darwin Core Data Package (DwC-DP)](https://gbif.github.io/dwc-dp/) specifications.

## Background

The DwC-DP introduces a more rigorous entity relationship model:

| Entity | Definition | Relationships |
|--------|------------|---------------|
| **Event** | Action/process occurring at location during time | Can be hierarchical (parent/child) |
| **Occurrence** | "A state of an Organism in an Event" | Links Organism ↔ Event |
| **Organism** | The biological entity being observed | Permanent traits stay here |
| **Identification** | Agent's opinion assigning Organism to Taxon | Multiple per Organism allowed |
| **MaterialEntity** | Physical matter (specimens, samples) | Supports Occurrence evidence |
| **Agent** | Person/org who conducted event or made ID | Referenced by conductedByID, identifiedByID |

BioSky's current flat model is pragmatically sufficient for community science, but these improvements will enhance data quality and GBIF export compatibility.

---

## Tier 1: Quick Wins (Lexicon Fields Already in DB)

**Status**: 🔲 Not Started

These fields exist in the database but aren't exposed in the lexicon—users can't set them.

### Add to `occurrence.json`

```json
"basisOfRecord": {
  "type": "string",
  "description": "Nature of the record (dwc:basisOfRecord).",
  "knownValues": ["HumanObservation", "MachineObservation", "PreservedSpecimen"],
  "default": "HumanObservation",
  "maxLength": 32
},
"occurrenceStatus": {
  "type": "string",
  "description": "Presence or absence (dwc:occurrenceStatus).",
  "knownValues": ["present", "absent"],
  "default": "present",
  "maxLength": 16
},
"individualCount": {
  "type": "integer",
  "description": "Number of individuals observed (dwc:individualCount).",
  "minimum": 1
},
"sex": {
  "type": "string",
  "description": "Sex of the organism (dwc:sex).",
  "knownValues": ["male", "female", "hermaphrodite", "unknown"],
  "maxLength": 32
},
"lifeStage": {
  "type": "string",
  "description": "Age class or life stage (dwc:lifeStage).",
  "knownValues": ["egg", "larva", "pupa", "juvenile", "adult", "unknown"],
  "maxLength": 32
},
"behavior": {
  "type": "string",
  "description": "Observed behavior (dwc:behavior).",
  "maxLength": 256
},
"habitat": {
  "type": "string",
  "description": "Habitat description (dwc:habitat).",
  "maxLength": 512
},
"reproductiveCondition": {
  "type": "string",
  "description": "Reproductive state (dwc:reproductiveCondition).",
  "knownValues": ["flowering", "fruiting", "budding", "in seed"],
  "maxLength": 64
},
"establishmentMeans": {
  "type": "string",
  "description": "How organism came to be in location (dwc:establishmentMeans).",
  "knownValues": ["native", "introduced", "cultivated", "invasive", "uncertain"],
  "maxLength": 32
}
```

**Impact**: Users can record richer observation data. DB already supports these fields.

---

## Tier 2: GBIF Export Compatibility

**Status**: ✅ Complete

### Added geographic hierarchy to `location` object

- `continent` - Continent name
- `country` - Country name
- `countryCode` - ISO 3166-1 alpha-2 country code
- `stateProvince` - State/province name
- `county` - County name
- `municipality` - Municipality name
- `locality` - Specific locality description
- `waterBody` - Name of water body
- `minimumElevationInMeters` / `maximumElevationInMeters` - Elevation bounds
- `minimumDepthInMeters` / `maximumDepthInMeters` - Depth bounds (aquatic)

**Impact**: Enables direct DwC-A export without reverse geocoding.

---

## Tier 3: Fix Identification Storage Bug

**Status**: ✅ Complete

The `upsertIdentification` method now correctly saves taxonomy fields from the lexicon to the database.

### Changes Made

1. Added migration to create taxonomy columns in identifications table:
   - `vernacular_name`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `confidence`
2. Updated `upsertIdentification` to save all taxonomy fields from the record
3. Updated all identification queries to include new columns
4. Updated `IdentificationRow` type definition

**Impact**: Taxonomy info from identifications is now properly stored and retrievable.

---

## Tier 4: Semantic Model Improvements

**Status**: 🔲 Not Started

### 4a. Distinguish Organism from Occurrence

The DwC-DP model separates:
- **Organism**: permanent traits (the individual)
- **Occurrence**: ephemeral state at that moment

The existing `subjectIndex` on Identification is a step toward this. Formalize with a new lexicon:

```json
{
  "lexicon": 1,
  "id": "org.rwell.test.organism",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["createdAt"],
        "properties": {
          "name": {
            "type": "string",
            "description": "Optional name for tracked individual (e.g., 'Blue-tagged Monarch #42').",
            "maxLength": 128
          },
          "organismScope": {
            "type": "string",
            "knownValues": ["individual", "colony", "pack", "population"],
            "default": "individual"
          },
          "organismRemarks": {
            "type": "string",
            "maxLength": 1000
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    }
  }
}
```

Then occurrences could optionally reference an organism:

```json
"organismRef": {
  "type": "ref",
  "ref": "com.atproto.repo.strongRef",
  "description": "Optional reference to a tracked organism for re-sightings."
}
```

**Use case**: Track the same tagged bird across multiple sightings.

### 4b. Event Hierarchy for Surveys

For structured surveys (bioblitzes, transects):

```json
{
  "lexicon": 1,
  "id": "org.rwell.test.event",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["eventDate", "createdAt"],
        "properties": {
          "parentEvent": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef"
          },
          "eventType": {
            "type": "string",
            "knownValues": ["observation", "survey", "transect", "pointCount", "bioblitz"]
          },
          "eventDate": { "type": "string", "format": "datetime" },
          "samplingProtocol": { "type": "string", "maxLength": 256 },
          "samplingEffort": { "type": "string", "maxLength": 256 },
          "eventRemarks": { "type": "string", "maxLength": 1000 },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

**Use case**: Group multiple occurrences under a single survey event.

---

## Tier 5: Identification Enhancements

**Status**: 🔲 Not Started

### Add missing DwC identification fields to lexicon

```json
"identificationQualifier": {
  "type": "string",
  "description": "Qualifier for uncertain IDs like 'cf.' or 'aff.' (dwc:identificationQualifier).",
  "knownValues": ["cf.", "aff.", "?"],
  "maxLength": 16
},
"identificationVerificationStatus": {
  "type": "string",
  "description": "Verification state (dwc:identificationVerificationStatus).",
  "knownValues": ["verified", "unverified", "questionable", "incorrect"],
  "maxLength": 32
}
```

**Impact**: Better data quality tracking for identifications.

---

## Implementation Priority

| Phase | Changes | Effort | Impact |
|-------|---------|--------|--------|
| **1** | Add Tier 1 fields to occurrence lexicon | Low | High - richer data capture |
| **2** | ~~Add geographic hierarchy to location~~ | ~~Low~~ | ~~High - GBIF export ready~~ ✅ |
| **3** | Fix identification DB storage bug | Low | Medium - data integrity |
| **4** | Add identificationQualifier, verificationStatus | Low | Medium - data quality |
| **5** | Create Organism lexicon for re-sightings | Medium | Medium - power users |
| **6** | Create Event lexicon for surveys | Medium | Low - structured surveys |

---

## References

- [Darwin Core Conceptual Model](https://gbif.github.io/dwc-dp/#cm)
- [Darwin Core Data Package](https://gbif.github.io/dwc-dp/)
- [Darwin Core Quick Reference](https://dwc.tdwg.org/terms/)
- [GBIF Data Quality Requirements](https://www.gbif.org/data-quality-requirements-occurrences)
