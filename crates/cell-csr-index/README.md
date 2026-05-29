# cell-csr-index

Zero-copy, mmap-backed index mapping [H3](https://h3geo.org) cells to sorted
`u32` ID lists, with O(log n) point lookup.

Given a latitude/longitude, `ids_at` returns the IDs associated with the H3
cell covering that point — a building block for any "what entities are relevant
at this location?" lookup (species range maps, points of interest,
region/coverage membership, …).

## Usage

```rust,ignore
use cell_csr_index::CellCsrIndex;

// `Some(n)` validates the file's declared count against `n` (catches a stale
// index whose IDs would point at the wrong rows); `None` skips that check.
let index = CellCsrIndex::load(path, Some(num_labels))?;

for &id in index.ids_at(37.77, -122.42) {
    // ...
}
```

## On-disk format

A compact `OGI1` binary (32-byte header + CSR `cells`/`offsets`/`ids` arrays),
documented in the crate root docs. The file is mmap'd, so only the pages
touched by a lookup are paged in — a multi-hundred-MB index costs a handful of
resident pages per query. Little-endian targets only (the slices are
reinterpreted zero-copy).

The format is intended to be produced by an offline build pipeline; this crate
is the read side.
