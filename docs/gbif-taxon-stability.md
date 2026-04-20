# GBIF Taxon Stability

How stable are GBIF taxon identifiers and scientific names, and what are the
implications for Observ.ing.

## Taxon Key (Numeric ID) Stability

GBIF's backbone taxonomy is rebuilt periodically. When this happens:

- Taxa can be merged, split, or reclassified.
- Numeric taxon keys (e.g. `gbif:3084746`) can change or become invalid.
- GBIF states: "Wherever possible, GBIF will reuse the same identifier issued
  for a taxon concept in the previous backbone."
- This is a **best-effort** policy, not a formal stability guarantee.
- It is unclear from GBIF documentation whether old/deprecated keys remain
  resolvable via the API (e.g. returning a synonym record pointing to the
  current accepted key) or return a 404.

Reference: [Six questions answered about the GBIF Backbone Taxonomy](https://data-blog.gbif.org/post/gbif-backbone-taxonomy/)

## Scientific Name Stability

Scientific names are more stable than numeric keys in the sense that they don't
get reassigned to unrelated taxa. However, names do change through taxonomic
revisions (synonymy, reclassification, etc.).

Observ.ing stores both `taxonId` (the GBIF key) and `scientificName` alongside
the full taxonomic hierarchy (`kingdom`, `phylum`, `class`, `order`, `family`,
`genus`). This gives two paths to resolve a taxon if one changes.

> Only `scientificName`, `taxonRank`, `kingdom`, and `identificationRemarks` are
> declared in the upstream `bio.lexicons.temp.identification` schema. `taxonId`
> and the rest of the hierarchy are app-specific extra JSON fields written by
> the appview and indexed by the ingester — see `darwin-core.md` for the full
> list of schema drift.

## Cross-Kingdom Homonyms

The same scientific name can exist in different kingdoms. These are called
**hemihomonyms** and are formally allowed because different kingdoms are governed
by different nomenclatural codes (ICN for plants, ICZN for animals, etc.).

Examples:

- *Ficus* -- both a plant genus (figs) and a gastropod genus (snails)
- *Aotus* -- both golden peas (plants) and night monkeys (animals)
- *Orestias elegans* -- both a fish and an orchid

There are at least 1,258 known cases of genus-level duplication across kingdoms.

GBIF's own guidance: **always supply kingdom or higher classification alongside
the scientific name** to disambiguate homonyms. Their name-matching API performs
better when given higher taxonomy context.

Reference: [GBIF Taxonomy Interpretation](https://techdocs.gbif.org/en/data-processing/taxonomy-interpretation)

## Implications for Observ.ing

- When querying or grouping by scientific name, always include kingdom (or other
  higher classification) to avoid conflating unrelated organisms.
- The identification schema already stores `kingdom` alongside `scientificName`
  and `taxonId`, which is the right approach.
- Database queries that match on `scientific_name` at the species level should be
  aware of potential homonyms, though in practice these are rare (~1,258 known
  genus-level cases).
- Storing both the GBIF numeric key and the scientific name provides resilience
  against either one changing over time.
