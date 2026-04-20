# Float/String Decision for Coordinates

> **Status: resolved.** The project uses **strings** for decimal coordinates, consistent with the wider AT Protocol lexicon community. This doc is kept as a decision record.

## Context

AT Protocol's data model does not support IEEE 754 floating point numbers — only integers, strings, bytes, CIDs, arrays, and objects. So coordinate values like `37.7749` cannot be stored as raw floats in a record.

## Decision

`decimalLatitude` and `decimalLongitude` in `bio.lexicons.temp.occurrence` are declared as `"type": "string"` and stored in PostgreSQL as numeric values (converted via `parse::<f64>()` in the shared processing module).

The alternative — scaled integers (e.g., microdegrees) — was rejected because:

- String representation matches upstream convention (the `lexicon-community/lexicon` project's `community.lexicon.location.geo` uses strings).
- Lossless round-trip: the original user-entered precision is preserved in the record; downgrading on write loses that.
- Interop: GBIF and Darwin Core exchange coordinates as decimal strings, so `string` avoids a conversion at export time.

## References

- [AT Protocol Data Model](https://atproto.com/specs/data-model) — explains the float prohibition.
- [Lexicon Community: community.lexicon.location.geo](https://github.com/lexicon-community/lexicon) — the cross-project location lexicon also uses strings.
