# BioSky Lexicon Design Plan

A comprehensive plan for designing resilient AT Protocol lexicons for the BioSky biodiversity observation platform, aligned with Darwin Core standards and GBIF data models.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Assessment](#current-state-assessment)
3. [AT Protocol Design Principles](#at-protocol-design-principles)
4. [Namespace Strategy](#namespace-strategy)
5. [Darwin Core Alignment](#darwin-core-alignment)
6. [Proposed Lexicon Architecture](#proposed-lexicon-architecture)
7. [Detailed Lexicon Specifications](#detailed-lexicon-specifications)
8. [Migration Path](#migration-path)
9. [Future Considerations](#future-considerations)

---

## Executive Summary

BioSky is a decentralized biodiversity observation platform built on AT Protocol. This document outlines a lexicon design strategy that:

- **Maximizes Darwin Core compatibility** for interoperability with GBIF and other biodiversity databases
- **Follows AT Protocol best practices** including sidecar records, hydrated views, and proper versioning
- **Plans for future extensibility** with social features, data quality workflows, and citizen science capabilities
- **Maintains simplicity** by keeping required fields minimal and extending through optional fields

---

## Current State Assessment

### Existing Lexicons

| Lexicon | Purpose | Status |
|---------|---------|--------|
| `org.rwell.test.occurrence` | Biodiversity observations | Production-ready core |
| `org.rwell.test.identification` | Taxonomic identifications | Production-ready core |

### Strengths of Current Design

1. **Darwin Core foundation**: Core fields (`scientificName`, `eventDate`, `decimalLatitude`, `decimalLongitude`) follow DwC standards
2. **Image support**: Up to 10 images with accessibility requirements (alt text)
3. **Community consensus model**: `identification` supports proposals and agreements via `isAgreement` flag
4. **Proper AT Protocol patterns**: Uses `strongRef` for immutable references, `tid` keys

### Areas for Improvement

1. **Namespace**: `org.rwell.test` suggests experimental status; needs production namespace
2. **Enum usage**: `taxonRank` and `confidence` use closed enums (not recommended per AT Protocol style guide)
3. **Missing Darwin Core fields**: Several commonly-used fields are only in database, not lexicon
4. **No social features**: No lexicons for likes, follows, bookmarks, or comments
5. **No data quality workflow**: No support for flagging, verification, or moderation

---

## AT Protocol Design Principles

Based on [AT Protocol Lexicon Style Guide](https://atproto.com/guides/lexicon-style-guide) and community best practices:

### 1. Naming Conventions

```
✓ lowerCamelCase for fields (scientificName, eventDate)
✓ Singular nouns for records (occurrence, identification)
✓ verb-noun for endpoints (getOccurrence, listIdentifications)
✗ Avoid closed enums; use knownValues instead
```

### 2. Field Requirements

- Only mark fields `required` if truly essential (cannot be made optional later)
- Add optional fields freely for backward compatibility
- Specify `maxLength` for strings in records
- Use `format: "datetime"` with millisecond precision minimum

### 3. Extension Patterns

**Sidecar Records**: Define supplementary records with same key but different collection type
```
occurrence (rkey: abc123)     → core data
occurrenceMetadata (rkey: abc123) → extended Darwin Core fields
```

**Hydrated Views**: Include original record verbatim in API responses rather than defining supersets

### 4. References

- Use `strongRef` (CID + URI) for immutable references to specific record versions
- Use DID (not handle) for account references
- Use `at-identifier` in API endpoints for flexibility

---

## Namespace Strategy

### Recommended Namespace: `bio.sky.*`

```
bio.sky.observation.occurrence     # Core observation record
bio.sky.observation.identification # Taxonomic identification
bio.sky.observation.comment        # Discussion/comments
bio.sky.graph.follow               # Follow naturalists
bio.sky.graph.bookmark             # Save observations
bio.sky.feed.like                  # Appreciate observations
bio.sky.quality.flag               # Data quality flags
bio.sky.quality.annotation         # Data annotations
bio.sky.actor.profile              # Naturalist profile extensions
```

### Alternative: Reuse `app.bsky.*` Where Possible

For social primitives (like, follow), consider reusing Bluesky's existing lexicons:
- `app.bsky.feed.like` - Already supports `strongRef` subject
- `app.bsky.graph.follow` - Standard follow relationship

**Recommendation**: Define domain-specific lexicons under `bio.sky.*` but design them to be compatible with `app.bsky.*` equivalents where semantics align.

---

## Darwin Core Alignment

### Field Coverage Matrix

| Darwin Core Term | Current Status | Recommendation |
|------------------|----------------|----------------|
| **Record-level** | | |
| `basisOfRecord` | DB only | Add to lexicon (knownValues) |
| `license` | Missing | Add as optional |
| `institutionCode` | Missing | Add for museum specimens |
| **Occurrence** | | |
| `occurrenceID` | AT URI serves this | No change needed |
| `scientificName` | ✓ In lexicon | Keep |
| `recordedBy` | DB only | Add as optional array |
| `individualCount` | DB only | Add as optional |
| `sex` | DB only | Add with knownValues |
| `lifeStage` | DB only | Add with knownValues |
| `occurrenceStatus` | DB only | Add with knownValues |
| `behavior` | DB only | Add as optional |
| `habitat` | DB only | Add as optional |
| **Event** | | |
| `eventDate` | ✓ In lexicon | Keep |
| `eventType` | Missing | Add with knownValues |
| `samplingProtocol` | Missing | Add for surveys |
| **Location** | | |
| `decimalLatitude` | ✓ In lexicon | Keep |
| `decimalLongitude` | ✓ In lexicon | Keep |
| `coordinateUncertaintyInMeters` | ✓ In lexicon | Keep |
| `geodeticDatum` | ✓ In lexicon | Keep |
| `verbatimLocality` | ✓ In lexicon | Keep |
| `country` | Missing | Add as optional |
| `stateProvince` | Missing | Add as optional |
| `locality` | Missing | Add as optional |
| `elevation` | Missing | Add as optional |
| `depth` | Missing | Add for aquatic obs |
| **Identification** | | |
| `taxonName` | ✓ In lexicon (as `scientificName` equivalent) | Keep |
| `taxonRank` | ✓ In lexicon | Convert enum → knownValues |
| `identifiedBy` | Implicit (DID) | No change needed |
| `dateIdentified` | ✓ In lexicon (as `createdAt`) | Keep |
| `identificationRemarks` | ✓ In lexicon (as `comment`) | Keep |
| `identificationVerificationStatus` | Missing | Add with knownValues |

### GBIF Data Quality Fields

For GBIF compatibility and data export, consider these additional fields:

| Field | Purpose | Implementation |
|-------|---------|----------------|
| `dataGeneralizations` | Note if location obscured | Optional string |
| `informationWithheld` | Note if data redacted | Optional string |
| `georeferenceVerificationStatus` | Location verification state | knownValues |
| `identificationVerificationStatus` | ID verification state | knownValues |

---

## Proposed Lexicon Architecture

### Core Records (Star Schema Center)

```
┌─────────────────────────────────────────────────────────────┐
│                    bio.sky.observation.occurrence           │
│  ─────────────────────────────────────────────────────────  │
│  Required: scientificName, eventDate, location, createdAt   │
│  Optional: images, notes, habitat, behavior, recordedBy...  │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ identification│    │    comment    │    │     flag      │
│   (strongRef) │    │   (strongRef) │    │   (strongRef) │
└───────────────┘    └───────────────┘    └───────────────┘
```

### Social Graph Records

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  graph.follow   │    │   feed.like     │    │ graph.bookmark  │
│  subject: DID   │    │ subject: ref    │    │  subject: ref   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Data Quality Records

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  quality.flag   │    │quality.annotation│   │quality.verification│
│  type: enum     │    │  field: string  │    │  status: enum   │
│  subject: ref   │    │  subject: ref   │    │  subject: ref   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Detailed Lexicon Specifications

### 1. `bio.sky.observation.occurrence` (Updated)

```json
{
  "lexicon": 1,
  "id": "bio.sky.observation.occurrence",
  "defs": {
    "main": {
      "type": "record",
      "description": "A biodiversity observation record following Darwin Core standards.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["scientificName", "eventDate", "location", "createdAt"],
        "properties": {
          "scientificName": {
            "type": "string",
            "description": "Full scientific name (dwc:scientificName).",
            "maxLength": 256
          },
          "eventDate": {
            "type": "string",
            "format": "datetime",
            "description": "When the observation occurred (dwc:eventDate)."
          },
          "location": {
            "type": "ref",
            "ref": "#location"
          },
          "images": {
            "type": "array",
            "items": { "type": "ref", "ref": "#imageEmbed" },
            "maxLength": 10
          },
          "notes": {
            "type": "string",
            "maxLength": 3000
          },
          "basisOfRecord": {
            "type": "string",
            "description": "Nature of the record (dwc:basisOfRecord).",
            "knownValues": [
              "HumanObservation",
              "MachineObservation",
              "PreservedSpecimen",
              "LivingSpecimen",
              "FossilSpecimen",
              "MaterialSample"
            ],
            "default": "HumanObservation"
          },
          "occurrenceStatus": {
            "type": "string",
            "description": "Presence/absence (dwc:occurrenceStatus).",
            "knownValues": ["present", "absent"],
            "default": "present"
          },
          "individualCount": {
            "type": "integer",
            "minimum": 0,
            "description": "Number of individuals (dwc:individualCount)."
          },
          "sex": {
            "type": "string",
            "description": "Sex of organism(s) (dwc:sex).",
            "knownValues": ["male", "female", "hermaphrodite", "unknown"],
            "maxLength": 64
          },
          "lifeStage": {
            "type": "string",
            "description": "Life stage (dwc:lifeStage).",
            "knownValues": ["egg", "larva", "juvenile", "adult", "unknown"],
            "maxLength": 64
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
          "recordedBy": {
            "type": "array",
            "description": "DIDs of observers (maps to dwc:recordedBy).",
            "items": { "type": "string", "format": "did" },
            "maxLength": 10
          },
          "samplingProtocol": {
            "type": "string",
            "description": "Method used (dwc:samplingProtocol).",
            "maxLength": 256
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    },
    "location": {
      "type": "object",
      "required": ["decimalLatitude", "decimalLongitude"],
      "properties": {
        "decimalLatitude": {
          "type": "string",
          "description": "Latitude in decimal degrees (-90 to 90)."
        },
        "decimalLongitude": {
          "type": "string",
          "description": "Longitude in decimal degrees (-180 to 180)."
        },
        "coordinateUncertaintyInMeters": {
          "type": "integer",
          "minimum": 0
        },
        "geodeticDatum": {
          "type": "string",
          "default": "WGS84",
          "maxLength": 64
        },
        "verbatimLocality": {
          "type": "string",
          "maxLength": 1024
        },
        "country": {
          "type": "string",
          "maxLength": 128
        },
        "stateProvince": {
          "type": "string",
          "maxLength": 128
        },
        "elevation": {
          "type": "number",
          "description": "Elevation in meters above sea level."
        },
        "depth": {
          "type": "number",
          "description": "Depth in meters below surface (aquatic)."
        }
      }
    },
    "imageEmbed": {
      "type": "object",
      "required": ["image", "alt"],
      "properties": {
        "image": {
          "type": "blob",
          "accept": ["image/jpeg", "image/png", "image/webp"],
          "maxSize": 10000000
        },
        "alt": {
          "type": "string",
          "maxLength": 1000
        },
        "aspectRatio": {
          "type": "ref",
          "ref": "#aspectRatio"
        }
      }
    },
    "aspectRatio": {
      "type": "object",
      "required": ["width", "height"],
      "properties": {
        "width": { "type": "integer", "minimum": 1 },
        "height": { "type": "integer", "minimum": 1 }
      }
    }
  }
}
```

### 2. `bio.sky.observation.identification` (Updated)

```json
{
  "lexicon": 1,
  "id": "bio.sky.observation.identification",
  "defs": {
    "main": {
      "type": "record",
      "description": "A taxonomic identification for an observation.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["subject", "taxonName", "createdAt"],
        "properties": {
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Reference to the observation being identified."
          },
          "taxonName": {
            "type": "string",
            "description": "Scientific name being proposed.",
            "maxLength": 256
          },
          "taxonRank": {
            "type": "string",
            "description": "Taxonomic rank level.",
            "knownValues": [
              "kingdom", "phylum", "class", "order", "family",
              "genus", "species", "subspecies", "variety", "form"
            ],
            "default": "species",
            "maxLength": 32
          },
          "taxonId": {
            "type": "string",
            "description": "External taxon identifier (GBIF, iNat, etc.).",
            "maxLength": 256
          },
          "taxonSource": {
            "type": "string",
            "description": "Source of taxonId.",
            "knownValues": ["gbif", "inaturalist", "col", "itis", "worms"],
            "maxLength": 64
          },
          "comment": {
            "type": "string",
            "description": "Reasoning for this identification.",
            "maxLength": 3000
          },
          "isAgreement": {
            "type": "boolean",
            "description": "True if agreeing with current community ID.",
            "default": false
          },
          "confidence": {
            "type": "string",
            "description": "Confidence level in identification.",
            "knownValues": ["low", "medium", "high"],
            "default": "medium",
            "maxLength": 16
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

### 3. `bio.sky.observation.comment` (New)

```json
{
  "lexicon": 1,
  "id": "bio.sky.observation.comment",
  "defs": {
    "main": {
      "type": "record",
      "description": "A discussion comment on an observation.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["subject", "text", "createdAt"],
        "properties": {
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Reference to observation being discussed."
          },
          "replyTo": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Reference to parent comment if this is a reply."
          },
          "text": {
            "type": "string",
            "maxLength": 3000
          },
          "facets": {
            "type": "array",
            "description": "Rich text annotations (mentions, links, tags).",
            "items": { "type": "ref", "ref": "app.bsky.richtext.facet" }
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

### 4. `bio.sky.feed.like` (New)

```json
{
  "lexicon": 1,
  "id": "bio.sky.feed.like",
  "defs": {
    "main": {
      "type": "record",
      "description": "A like/appreciation of an observation.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["subject", "createdAt"],
        "properties": {
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Reference to the liked observation."
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

### 5. `bio.sky.graph.follow` (New)

```json
{
  "lexicon": 1,
  "id": "bio.sky.graph.follow",
  "defs": {
    "main": {
      "type": "record",
      "description": "Follow a naturalist to see their observations.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["subject", "createdAt"],
        "properties": {
          "subject": {
            "type": "string",
            "format": "did",
            "description": "DID of the account being followed."
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

### 6. `bio.sky.graph.bookmark` (New)

```json
{
  "lexicon": 1,
  "id": "bio.sky.graph.bookmark",
  "defs": {
    "main": {
      "type": "record",
      "description": "Bookmark an observation for later reference.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["subject", "createdAt"],
        "properties": {
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Reference to the bookmarked observation."
          },
          "collection": {
            "type": "string",
            "description": "Optional collection/folder name.",
            "maxLength": 128
          },
          "note": {
            "type": "string",
            "description": "Private note about why bookmarked.",
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

### 7. `bio.sky.quality.flag` (New)

```json
{
  "lexicon": 1,
  "id": "bio.sky.quality.flag",
  "defs": {
    "main": {
      "type": "record",
      "description": "Flag an observation for data quality issues.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["subject", "flagType", "createdAt"],
        "properties": {
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef"
          },
          "flagType": {
            "type": "string",
            "description": "Type of data quality issue.",
            "knownValues": [
              "location-inaccurate",
              "date-inaccurate",
              "organism-wild",
              "organism-captive",
              "media-copyright",
              "media-inappropriate",
              "spam",
              "duplicate",
              "other"
            ],
            "maxLength": 64
          },
          "comment": {
            "type": "string",
            "description": "Explanation of the flag.",
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

### 8. `bio.sky.quality.annotation` (New)

```json
{
  "lexicon": 1,
  "id": "bio.sky.quality.annotation",
  "defs": {
    "main": {
      "type": "record",
      "description": "Community annotation adding structured data to an observation.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["subject", "field", "value", "createdAt"],
        "properties": {
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef"
          },
          "field": {
            "type": "string",
            "description": "Darwin Core field being annotated.",
            "knownValues": [
              "sex", "lifeStage", "behavior", "habitat",
              "reproductiveCondition", "establishmentMeans"
            ],
            "maxLength": 64
          },
          "value": {
            "type": "string",
            "description": "Value for the field.",
            "maxLength": 256
          },
          "comment": {
            "type": "string",
            "maxLength": 500
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

### 9. `bio.sky.actor.profile` (New - Sidecar)

```json
{
  "lexicon": 1,
  "id": "bio.sky.actor.profile",
  "defs": {
    "main": {
      "type": "record",
      "description": "Extended naturalist profile information.",
      "key": "self",
      "record": {
        "type": "object",
        "properties": {
          "displayName": {
            "type": "string",
            "maxLength": 128
          },
          "bio": {
            "type": "string",
            "maxLength": 2000
          },
          "avatar": {
            "type": "blob",
            "accept": ["image/jpeg", "image/png"],
            "maxSize": 1000000
          },
          "expertise": {
            "type": "array",
            "description": "Taxonomic groups user has expertise in.",
            "items": { "type": "string", "maxLength": 128 },
            "maxLength": 20
          },
          "location": {
            "type": "string",
            "description": "General location (not coordinates).",
            "maxLength": 256
          },
          "affiliations": {
            "type": "array",
            "description": "Organizations, institutions, or projects.",
            "items": { "type": "string", "maxLength": 256 },
            "maxLength": 10
          },
          "externalLinks": {
            "type": "array",
            "items": { "type": "ref", "ref": "#externalLink" },
            "maxLength": 5
          }
        }
      }
    },
    "externalLink": {
      "type": "object",
      "required": ["uri", "label"],
      "properties": {
        "uri": { "type": "string", "format": "uri" },
        "label": { "type": "string", "maxLength": 64 }
      }
    }
  }
}
```

---

## Migration Path

### Phase 1: Namespace Transition (Breaking Change)

1. Register `bio.sky` namespace
2. Create new lexicons under `bio.sky.*`
3. Update appview to handle both namespaces during transition
4. Migrate existing records via re-publication or batch migration

### Phase 2: Lexicon Enhancement (Non-Breaking)

1. Add optional Darwin Core fields to occurrence
2. Convert enums to knownValues in identification
3. Add `taxonId` and `taxonSource` fields for external taxonomic databases

### Phase 3: Social Features

1. Implement `bio.sky.feed.like`
2. Implement `bio.sky.graph.follow`
3. Implement `bio.sky.graph.bookmark`
4. Implement `bio.sky.observation.comment`

### Phase 4: Data Quality Workflow

1. Implement `bio.sky.quality.flag`
2. Implement `bio.sky.quality.annotation`
3. Build verification status aggregation in appview

---

## Future Considerations

### Potential Future Lexicons

| Lexicon | Purpose | Priority |
|---------|---------|----------|
| `bio.sky.observation.project` | Citizen science project membership | Medium |
| `bio.sky.observation.checklist` | Species checklist for a location | Medium |
| `bio.sky.observation.survey` | Structured survey/transect data | Low |
| `bio.sky.quality.verification` | Expert verification status | Medium |
| `bio.sky.graph.block` | Block users | Low |
| `bio.sky.moderation.report` | Report policy violations | Medium |

### Interoperability Opportunities

1. **GBIF Export**: Design occurrence records to map directly to GBIF DwC-A format
2. **iNaturalist Import**: Consider field mapping for users migrating from iNat
3. **eBird Integration**: For bird observations, consider eBird checklist compatibility
4. **DNA Barcode DBs**: Add fields for BOLD/GenBank sequence references

### Federation Considerations

1. **Cross-PDS Identification**: Identifications can reference observations on any PDS
2. **AppView Aggregation**: AppView must aggregate records across federated network
3. **Moderation Labels**: Support `com.atproto.label` for content moderation

### Machine Learning Integration

1. **CV Suggestions**: Field for AI-suggested identifications with source/model info
2. **Auto-annotation**: Machine-detected life stage, sex, behavior from images
3. **Location Verification**: Automated plausibility checking for species ranges

---

## References

- [AT Protocol Lexicon Specification](https://atproto.com/specs/lexicon)
- [AT Protocol Lexicon Style Guide](https://atproto.com/guides/lexicon-style-guide)
- [Darwin Core Quick Reference](https://dwc.tdwg.org/terms/)
- [GBIF Darwin Core Guide](https://www.gbif.org/darwin-core)
- [Bluesky Lexicons (GitHub)](https://github.com/bluesky-social/atproto/tree/main/lexicons)
- [Elegant Lexicon Design (WhiteWind)](https://whtwnd.com/void.comind.network/3lu4rr7vjic2h)

---

## Appendix: Complete Namespace Map

```
bio.sky.
├── observation/
│   ├── occurrence      # Core observation record
│   ├── identification  # Taxonomic ID
│   └── comment         # Discussion
├── feed/
│   └── like            # Appreciation
├── graph/
│   ├── follow          # Social follow
│   ├── bookmark        # Save for later
│   └── block           # Block user (future)
├── quality/
│   ├── flag            # Data quality flag
│   ├── annotation      # Field annotation
│   └── verification    # Expert verification (future)
├── actor/
│   └── profile         # Extended profile
└── project/            # Future: citizen science projects
    ├── membership
    └── definition
```
