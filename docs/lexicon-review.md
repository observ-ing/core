# Lexicon Review: GBIF Alignment & AT Protocol Best Practices

Research comparing our lexicons against GBIF data models, Darwin Core standards, and other AT Protocol lexicons across the ecosystem.

## Sources Examined

1. **Our lexicons**: 5 record types under `org.rwell.test.*`
2. **GBIF models**: Occurrence (200+ fields), Species/Taxon, Dataset, plus 31 registered extensions
3. **AT Protocol lexicons**: Bluesky (`app.bsky.*`), Frontpage (`fyi.unravel.frontpage.*`), WhiteWind (`com.whtwnd.blog.*`), PinkSea, Statusphere, Smoke Signal, Recipe Exchange, Octosphere (science pubs), and the `community.lexicon.*` standardization effort

---

## Priority 1: GBIF Model Alignment Gaps

### 1A. Missing from Occurrence — High-Value GBIF Fields

| GBIF Field | Why It Matters | Recommendation |
|---|---|---|
| **`basisOfRecord`** | GBIF's single most important metadata field. Every record has one. Our app always assumes `HUMAN_OBSERVATION`, but this should be explicit for export compatibility. | Add as `knownValues` with `HUMAN_OBSERVATION` default. Values: `HUMAN_OBSERVATION`, `MACHINE_OBSERVATION`, `OBSERVATION`. Keeps the door open for camera trap integrations. |
| **`occurrenceStatus`** | GBIF uses `PRESENT` / `ABSENT`. Absence records are scientifically important ("I surveyed here and did NOT find species X"). | Add as `knownValues` with `PRESENT` default |
| **`individualCount`** | GBIF tracks how many individuals were observed. Very common field in citizen science. | Add as optional `integer`, `minimum: 1` |
| **`sex`** | GBIF enumerates: MALE, FEMALE, HERMAPHRODITE. Important for vertebrate observations. | Add as optional string with `knownValues` |
| **`lifeStage`** | GBIF enumerates: ADULT, JUVENILE, LARVA, EGG, etc. Critical for insects, amphibians. | Add as optional string with `knownValues` |
| **`habitat`** | Free-text habitat description. GBIF uses `dwc:habitat`. | Add as optional string, `maxLength: 512` |
| **`recordedByID`** | GBIF supports ORCID URIs for observers. Our `recordedBy` uses DIDs (great!), but the field name diverges from GBIF convention. | No change needed — DID-based `recordedBy` is the AT Protocol equivalent. Appview can map DIDs to GBIF's `recordedByID` on export. |

### 1B. Identification Record — GBIF Alignment Gaps

| GBIF Field | Why It Matters | Recommendation |
|---|---|---|
| **`identificationQualifier`** | Values like `cf.` (compare with) and `aff.` (has affinity with) — standard taxonomic hedging. GBIF treats these as first-class. | Add as optional string, `maxLength: 16`, `knownValues: ["cf.", "aff."]` |
| **`scientificNameAuthorship`** | The authority citation (e.g., "L." for Linnaeus). GBIF stores this alongside every name. | Add as optional string, `maxLength: 256` |
| **`taxonId` deprecation** | We deprecated `taxonId`, but GBIF's `taxonID` is how every occurrence links to the backbone taxonomy. Server-side resolution (kingdom + name → GBIF match) is fine, but storing the resolved `taxonKey` in the identification gives a stable anchor. | Consider un-deprecating or renaming to `gbifKey` — store the GBIF backbone key when the server resolves it. This makes GBIF export trivial. Alternatively, keep it server-side-only in the DB (not the lexicon). |

### 1C. Field Naming Alignment

Field names are close to GBIF/Darwin Core but have a few divergences:

| Our Field | GBIF/DwC Field | Issue | Recommendation |
|---|---|---|---|
| `taxonName` (identification) | `scientificName` | GBIF always uses `scientificName` | **Rename to `scientificName`** for direct DwC mapping |
| `notes` (occurrence) | `occurrenceRemarks` | Different name, same concept | Keep `notes` — more natural for a social app. Map on export. |
| `blobs` (occurrence) | `associatedMedia` | Different name, different structure | Keep `blobs` — AT Protocol blob handling is its own thing. Map on export. |
| `confidence` (identification) | No DwC equivalent | Our extension | Keep as-is — good addition that GBIF lacks |
| `isAgreement` (identification) | No DwC equivalent | Our extension | Keep as-is — community ID consensus is an Observ.ing innovation |

### 1D. Location Object — Missing GBIF Fields

The `#location` sub-object is solid but missing a few that GBIF enriches:

| GBIF Field | Recommendation |
|---|---|
| `island` | Add as optional string — important for Pacific/Caribbean observations |
| `islandGroup` | Add as optional string |
| `coordinatePrecision` | GBIF tracks this separately from uncertainty. Lower priority. |
| `footprintWKT` | For non-point geometries (transect lines, survey plots). Lower priority — skip for now. |

---

## Priority 2: AT Protocol Best Practices

Patterns observed across other lexicon projects in the AT Protocol ecosystem.

### 2A. `knownValues` vs `enum`

The Lexicon community (Lexinomicon style guide) strongly recommends `knownValues` over `enum` for forward compatibility. Our lexicons use `enum` in three places:

- `interaction.direction`: `enum: ["AtoB", "BtoA", "bidirectional"]`
- `identification.confidence`: `enum: ["low", "medium", "high"]`
- `interaction.confidence`: `enum: ["low", "medium", "high"]`

**Takeaway**: Switch `confidence` to `knownValues`. Keep `direction` as `enum` since those three values truly are the only possibilities.

### 2B. Shared Definitions (`defs`) Pattern

Multiple projects (WhiteWind, Bluesky, Recipe Exchange) use a separate `*.defs` lexicon file for shared types. Our `#imageEmbed`, `#aspectRatio`, and `#location` are inline in `occurrence.json`.

**Takeaway**: Consider creating `org.rwell.test.defs` for types that could be reused. For instance, `#imageEmbed` and `#aspectRatio` could be shared between occurrence and any future record types. Low priority — cleanliness improvement, not a GBIF concern.

### 2C. Record vs View Separation

Bluesky's embed lexicons define both a storage format and a `#view` format (what the API returns). Our lexicons only define the record format.

**Takeaway**: Not urgent, but as the API matures, consider defining `#view` defs within lexicons to document what the appview returns (e.g., resolved taxonomy, computed community ID, GBIF backbone match info). This is how other AT Protocol apps distinguish "what's in the repo" from "what the API serves."

### 2D. `community.lexicon.location.geo` Compatibility

The ATGeo working group is standardizing a shared `community.lexicon.location.geo` object with `latitude`, `longitude`, `altitude`, `name` (all strings).

**Takeaway**: Our `#location` is far richer (Darwin Core aligned, admin hierarchy, etc.), which is correct for this domain. No need to adopt the community standard, but could consider referencing it as a subset for cross-app interop in the future.

---

## Priority 3: Structural Opportunities

### 3A. Media Metadata (from GBIF + Recipe Exchange)

GBIF's media model includes `creator`, `license`, `created`, `rightsHolder`, `description` per media item. Our `#imageEmbed` only has `image`, `alt`, `aspectRatio`.

**Takeaway**: Consider adding per-image fields:
- `license` (string) — could differ from the occurrence-level license
- `created` (datetime) — EXIF capture time, separate from observation time
- `description` (string) — more detailed than `alt`, can include natural language about what the photo shows

This would improve GBIF export fidelity since GBIF's `media[]` array expects these per-item.

### 3B. Interaction Record — GloBI Alignment

Our interaction record is innovative (no other AT Protocol app does this). The [GloBI (Global Biotic Interactions)](https://www.globalbioticinteractions.org/) project is the GBIF equivalent for species interactions.

**Takeaway**: Consider aligning `interactionType` `knownValues` with GloBI's interaction type vocabulary (which uses OBO ontology terms). This would make data exportable to GloBI. Specific terms to consider adding: `eats`, `visitedFlowerOf`, `hasHost`, `parasiteOf`, `preyedUponBy`.

### 3C. The `taxonName` → `scientificName` Rename

Every system in the biodiversity data ecosystem — GBIF, Darwin Core, Catalogue of Life, iNaturalist, BOLD — uses `scientificName`. Our use of `taxonName` in the identification record is the one naming divergence that could cause friction in every integration.

**Takeaway**: Strongly recommend renaming `taxonName` to `scientificName` in the identification lexicon. This is the single highest-impact naming change for GBIF alignment.

---

## Summary: Prioritized Action Items

### Must-do (GBIF alignment)

1. Rename `taxonName` → `scientificName` in identification lexicon
2. Add `basisOfRecord` to occurrence (with `HUMAN_OBSERVATION` default)
3. Add `occurrenceStatus` to occurrence (with `PRESENT` default)
4. Add `individualCount`, `sex`, `lifeStage` to occurrence
5. Add `identificationQualifier` to identification

### Should-do (data quality)

6. Add `habitat` to occurrence
7. Add per-image metadata (`license`, `created`) to `#imageEmbed`
8. Switch `confidence` from `enum` to `knownValues`
9. Add `island` / `islandGroup` to `#location`
10. Add `scientificNameAuthorship` to identification

### Nice-to-have (ecosystem interop)

11. Align interaction types with GloBI vocabulary
12. Extract shared defs into `org.rwell.test.defs`
13. Define `#view` types for API responses
14. Consider storing resolved `gbifKey` on identifications (server-side or in lexicon)

---

## Reference: Other AT Protocol Lexicons Surveyed

| Project | Namespace | Pattern Notes |
|---|---|---|
| **Bluesky** | `app.bsky.*` | Gold standard. Uses unions for embeds, `knownValues` for extensibility, `#view` defs for API responses, `strongRef` for all cross-record links. |
| **Frontpage** | `fyi.unravel.frontpage.*` | Link aggregator (HN-style). Comment threading with both `post` (root) and `parent` (direct parent) refs. |
| **WhiteWind** | `com.whtwnd.blog.*` | Long-form blog. Shared `defs` file for reusable types. `visibility` enum for access control. |
| **PinkSea** | `com.shinolabs.pinksea.*` | Drawing BBS. Image-centric records, `inResponseTo` for reply chains, `nsfw` boolean flag. |
| **Statusphere** | `xyz.statusphere.*` | Official demo app. Minimal record — just emoji + timestamp. Shows lexicons can be extremely simple. |
| **Smoke Signal** | `events.smokesignal.calendar.*` | Events/RSVP. CID pinning means RSVPs reference specific event versions. Location as sub-types. |
| **Recipe Exchange** | `exchange.recipe.*` | Rich structured data. Union-based attribution, ISO 8601 durations, Schema.org alignment. |
| **Octosphere** | `social.octosphere.*` | Scientific publications bridge. Uses `knownValues` for pub types, external IDs (DOI, ORCID), dual content (HTML + text). |
| **Lexicon Community** | `community.lexicon.*` | Standardization effort. `location.geo` object with lat/lng/alt as strings. ATGeo working group. |
