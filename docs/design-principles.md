# BioSky Design Principles

## 1. Defer to Established Standards

Wherever possible, delegate to GBIF and Darwin Core for:

- **Taxonomy** — Use GBIF's taxonomic backbone rather than maintaining our own species database
- **Data schemas** — Model our lexicons after Darwin Core terms and structures
- **Vocabularies** — Adopt Darwin Core controlled vocabularies (occurrence status, basis of record, etc.)

This reduces maintenance burden, ensures interoperability with the broader biodiversity data ecosystem, and leverages decades of domain expertise.

## 2. Data Portability

Make it easy for users to export their data:

- **Standard formats** — Support Darwin Core Archive exports for compatibility with GBIF and iNaturalist
- **No lock-in** — Users own their observations; the AT Protocol already provides this at the protocol level

Users should never feel trapped. If BioSky disappears tomorrow, their biodiversity records should live on.
