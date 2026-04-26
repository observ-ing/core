//! Geographic range index for species-identification reranking.
//!
//! Loads the `species_geo_index.bin` artifact produced by the `bioclip-models`
//! pipeline. Given a lat/lon, returns the BioCLIP species indices whose iNat
//! range maps cover that location — used to apply a soft boost to visually-
//! similar species that are plausible at the observer's location.
//!
//! The binary format (documented in full in `bioclip_models/geo.py`):
//!
//! ```text
//! Header (32 bytes):
//!   magic[4]       = b"OGI1"
//!   version        = u32 = 1
//!   num_species    = u32
//!   h3_resolution  = u32 (typically 4)
//!   num_cells      = u32
//!   num_entries    = u32
//!   reserved       = u32 x 2
//!
//! Body:
//!   cells[num_cells]:      u64 LE  (H3 indices, sorted ascending)
//!   offsets[num_cells+1]:  u32 LE  (CSR offsets into species_ids)
//!   species_ids[num_entries]: u32 LE
//! ```
//!
//! Lookup is O(log num_cells) via binary search.
//!
//! The file is mmap'd rather than read into the heap. The format is
//! native-endian-compatible on little-endian targets, so `bytemuck::cast_slice`
//! gives zero-copy `&[u64]` / `&[u32]` views into the mmap'd region. Only the
//! pages actually touched by binary search (~9 pages for a 200k-cell table)
//! are paged in by the OS, instead of the whole 1.2 GiB file living in RSS.

#[cfg(not(target_endian = "little"))]
compile_error!(
    "species_geo_index uses zero-copy reinterpret of LE u32/u64; recompile target is big-endian"
);

use crate::error::{Result, SpeciesIdError};
use h3o::{LatLng, Resolution};
use memmap2::Mmap;
use std::fs::File;
use std::ops::Range;
use std::path::Path;
use tracing::info;

const MAGIC: &[u8; 4] = b"OGI1";
const VERSION: u32 = 1;
const HEADER_SIZE: usize = 32;

/// Parsed 32-byte header. Owns only the fields the body decode/validation
/// path cares about — the two reserved u32s are read and discarded.
struct Header {
    num_species: u32,
    h3_resolution: Resolution,
    num_cells: usize,
    num_entries: usize,
}

impl Header {
    /// Parse and validate magic, version, and resolution. Does *not* check
    /// the species count or file size — those need additional context from
    /// the caller; see `validate_species_count` and `expected_file_size`.
    fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < HEADER_SIZE {
            return Err(SpeciesIdError::Config(format!(
                "Geo index too short ({} bytes) to contain header",
                bytes.len()
            )));
        }
        if &bytes[..4] != MAGIC {
            return Err(SpeciesIdError::Config(format!(
                "Bad geo index magic: expected {:?}, got {:?}",
                MAGIC,
                &bytes[..4]
            )));
        }

        let version = read_u32_le(bytes, 4);
        let num_species = read_u32_le(bytes, 8);
        let h3_res_u32 = read_u32_le(bytes, 12);
        let num_cells = read_u32_le(bytes, 16) as usize;
        let num_entries = read_u32_le(bytes, 20) as usize;

        if version != VERSION {
            return Err(SpeciesIdError::Config(format!(
                "Unsupported geo index version: {} (expected {})",
                version, VERSION
            )));
        }

        let h3_resolution = Resolution::try_from(u8::try_from(h3_res_u32).map_err(|_| {
            SpeciesIdError::Config(format!("H3 resolution {} out of range", h3_res_u32))
        })?)
        .map_err(|e| SpeciesIdError::Config(format!("Invalid H3 resolution: {}", e)))?;

        Ok(Self {
            num_species,
            h3_resolution,
            num_cells,
            num_entries,
        })
    }

    /// Fail if the label count disagrees with the embeddings — this means
    /// the geo index is stale and species indices would point at the wrong
    /// rows.
    fn validate_species_count(&self, expected: usize) -> Result<()> {
        if self.num_species as usize != expected {
            return Err(SpeciesIdError::Config(format!(
                "Geo index num_species ({}) does not match label count ({}) — \
                 index is stale",
                self.num_species, expected
            )));
        }
        Ok(())
    }

    /// Total file size this header implies, used to detect truncation.
    fn expected_file_size(&self) -> usize {
        HEADER_SIZE + self.num_cells * 8 + (self.num_cells + 1) * 4 + self.num_entries * 4
    }
}

/// Sorted cell → species-index lookup table, mmap'd from disk.
///
/// The three CSR arrays are byte ranges into `mmap`; `cells()`, `offsets()`,
/// and `species_ids()` reinterpret those ranges as native-typed slices.
/// Alignment is guaranteed by the file layout (header is 32 bytes;
/// `cells` is u64-aligned at offset 32; `offsets` and `species_ids` are
/// u32-aligned by construction) plus mmap returning page-aligned addresses.
pub struct GeoIndex {
    mmap: Mmap,
    cells: Range<usize>,
    offsets: Range<usize>,
    species_ids: Range<usize>,
    h3_resolution: Resolution,
}

impl GeoIndex {
    /// Load the geo index from a file on disk via mmap.
    ///
    /// `expected_num_species` is the BioCLIP label count; a mismatch means
    /// the index is stale relative to the embeddings and we refuse to load.
    pub fn load(path: &Path, expected_num_species: usize) -> Result<Self> {
        let file = File::open(path).map_err(|e| {
            SpeciesIdError::Config(format!(
                "Failed to open geo index at {}: {}",
                path.display(),
                e
            ))
        })?;
        // SAFETY: the model artifacts directory is read-only at runtime
        // (baked into the container image); nothing mutates this file
        // while we're mapped.
        let mmap = unsafe { Mmap::map(&file) }.map_err(|e| {
            SpeciesIdError::Config(format!(
                "Failed to mmap geo index at {}: {}",
                path.display(),
                e
            ))
        })?;

        let header = Header::parse(&mmap)?;
        header.validate_species_count(expected_num_species)?;

        let expected_size = header.expected_file_size();
        if mmap.len() != expected_size {
            return Err(SpeciesIdError::Config(format!(
                "Geo index size mismatch: expected {} bytes, got {}",
                expected_size,
                mmap.len()
            )));
        }

        let cells_start = HEADER_SIZE;
        let cells_end = cells_start + header.num_cells * 8;
        let offsets_start = cells_end;
        let offsets_end = offsets_start + (header.num_cells + 1) * 4;
        let species_ids_start = offsets_end;
        let species_ids_end = species_ids_start + header.num_entries * 4;

        // Mirror the prior `Body::validate` CSR-endpoint check directly
        // against the mmap'd offsets array. Catches bit-flips / adversarial
        // inputs that pass the file-size check but leave offsets malformed.
        let first_off = read_u32_le(&mmap, offsets_start);
        let last_off = read_u32_le(&mmap, offsets_end - 4);
        if first_off != 0 || last_off as usize != header.num_entries {
            return Err(SpeciesIdError::Config(
                "Geo index offsets are malformed (bad endpoints)".to_string(),
            ));
        }

        info!(
            num_cells = header.num_cells,
            num_entries = header.num_entries,
            h3_resolution = u8::from(header.h3_resolution),
            size_mb = mmap.len() / (1024 * 1024),
            "Geo index mmap'd"
        );

        Ok(Self {
            mmap,
            cells: cells_start..cells_end,
            offsets: offsets_start..offsets_end,
            species_ids: species_ids_start..species_ids_end,
            h3_resolution: header.h3_resolution,
        })
    }

    fn cells(&self) -> &[u64] {
        bytemuck::cast_slice(&self.mmap[self.cells.clone()])
    }

    fn offsets(&self) -> &[u32] {
        bytemuck::cast_slice(&self.mmap[self.offsets.clone()])
    }

    fn species_ids(&self) -> &[u32] {
        bytemuck::cast_slice(&self.mmap[self.species_ids.clone()])
    }

    /// Species indices whose range maps cover `(lat, lon)`.
    ///
    /// Returns an empty slice if the coordinates are invalid, the containing
    /// H3 cell is not in the index, or the cell has no mapped species.
    pub fn species_at(&self, lat: f64, lon: f64) -> &[u32] {
        let Ok(latlng) = LatLng::new(lat, lon) else {
            return &[];
        };
        let cell_u64: u64 = latlng.to_cell(self.h3_resolution).into();

        match self.cells().binary_search(&cell_u64) {
            Ok(i) => {
                let offsets = self.offsets();
                let start = offsets[i] as usize;
                let end = offsets[i + 1] as usize;
                &self.species_ids()[start..end]
            }
            Err(_) => &[],
        }
    }
}

fn read_u32_le(bytes: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(bytes[off..off + 4].try_into().expect("len 4"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build an in-memory geo index file with the CSR layout and write it to `path`.
    fn write_index(
        path: &Path,
        num_species: u32,
        resolution: Resolution,
        cells_and_species: &[(u64, &[u32])],
    ) {
        let num_cells = cells_and_species.len() as u32;
        let num_entries: u32 = cells_and_species.iter().map(|(_, s)| s.len() as u32).sum();

        let mut buf = Vec::new();
        buf.extend_from_slice(MAGIC);
        buf.extend_from_slice(&VERSION.to_le_bytes());
        buf.extend_from_slice(&num_species.to_le_bytes());
        buf.extend_from_slice(&(u8::from(resolution) as u32).to_le_bytes());
        buf.extend_from_slice(&num_cells.to_le_bytes());
        buf.extend_from_slice(&num_entries.to_le_bytes());
        buf.extend_from_slice(&[0u8; 8]); // reserved

        for (cell, _) in cells_and_species {
            buf.extend_from_slice(&cell.to_le_bytes());
        }
        let mut offset: u32 = 0;
        buf.extend_from_slice(&offset.to_le_bytes());
        for (_, species) in cells_and_species {
            offset += species.len() as u32;
            buf.extend_from_slice(&offset.to_le_bytes());
        }
        for (_, species) in cells_and_species {
            for s in *species {
                buf.extend_from_slice(&s.to_le_bytes());
            }
        }

        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&buf).unwrap();
    }

    #[test]
    fn load_and_lookup_roundtrip() {
        // Build an index with two real H3-4 cells, one for San Francisco and one
        // for Salt Lake City, covering different species sets.
        let sf = LatLng::new(37.77, -122.42).unwrap();
        let slc = LatLng::new(40.76, -111.89).unwrap();
        let sf_cell: u64 = sf.to_cell(Resolution::Four).into();
        let slc_cell: u64 = slc.to_cell(Resolution::Four).into();

        let mut cells: Vec<(u64, &[u32])> = vec![(sf_cell, &[0, 2]), (slc_cell, &[1, 2])];
        cells.sort_by_key(|(c, _)| *c);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("geo.bin");
        write_index(&path, 3, Resolution::Four, &cells);

        let index = GeoIndex::load(&path, 3).unwrap();

        assert_eq!(index.species_at(37.77, -122.42), &[0, 2]);
        assert_eq!(index.species_at(40.76, -111.89), &[1, 2]);
        // A point nowhere near either cell returns empty.
        assert!(index.species_at(0.0, 0.0).is_empty());
        // Out-of-range coordinates fail the LatLng constructor → empty.
        assert!(index.species_at(91.0, 0.0).is_empty());
    }

    #[test]
    fn rejects_stale_index_num_species_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("geo.bin");
        write_index(&path, 100, Resolution::Four, &[]);

        let msg = match GeoIndex::load(&path, 200) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("should reject stale index"),
        };
        assert!(msg.contains("stale"), "unexpected error: {}", msg);
    }

    /// Cross-repo smoke test: loads a real index produced by the Python
    /// build pipeline and confirms the byte-level format is compatible
    /// end-to-end. Skipped unless the fixture exists at
    /// /tmp/cross_repo_test/species_geo_index.bin. Copy the artifact there
    /// and adjust `SPECIES_COUNT` to match the label set it was built against.
    ///
    /// This checks the format contract (loadable, in-range ids, within-cell
    /// sorting), not specific behavior — the species content depends on the
    /// fixture.
    #[test]
    #[ignore = "requires cross-repo fixture from bioclip-models"]
    fn cross_repo_python_built_index() {
        const SPECIES_COUNT: usize = 100_000;
        let path = std::path::PathBuf::from("/tmp/cross_repo_test/species_geo_index.bin");
        let idx = GeoIndex::load(&path, SPECIES_COUNT).unwrap();

        // A densely-populated land cell should yield many species in a real index.
        let sf = idx.species_at(37.77, -122.42);
        assert!(!sf.is_empty(), "SF should not be empty in a real index");
        assert!(
            sf.iter().all(|&i| (i as usize) < SPECIES_COUNT),
            "all returned species indices must be in-range"
        );
        // Per the format contract, species_ids within a cell are sorted ascending.
        assert!(
            sf.windows(2).all(|w| w[0] < w[1]),
            "species_ids within a cell must be sorted"
        );
    }

    #[test]
    fn rejects_bad_magic() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("geo.bin");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"XXXX").unwrap();
        f.write_all(&[0u8; 28]).unwrap();

        let msg = match GeoIndex::load(&path, 1) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("should reject bad magic"),
        };
        assert!(msg.contains("magic"), "unexpected error: {}", msg);
    }
}
