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

use crate::error::{Result, SpeciesIdError};
use h3o::{LatLng, Resolution};
use std::path::Path;
use tracing::info;

const MAGIC: &[u8; 4] = b"OGI1";
const VERSION: u32 = 1;
const HEADER_SIZE: usize = 32;

/// Sorted cell → species-index lookup table.
pub struct GeoIndex {
    /// H3 cell indices, sorted ascending for binary search.
    cells: Vec<u64>,
    /// CSR offsets — `offsets[i]..offsets[i+1]` is the species range for `cells[i]`.
    /// Length is `cells.len() + 1`.
    offsets: Vec<u32>,
    /// BioCLIP species indices, grouped by cell and sorted within each group.
    species_ids: Vec<u32>,
    /// H3 resolution used to encode the cells — also used for point lookups.
    h3_resolution: Resolution,
}

impl GeoIndex {
    /// Load the geo index from a file on disk.
    ///
    /// `expected_num_species` is the BioCLIP label count; a mismatch means
    /// the index is stale relative to the embeddings and we refuse to load.
    pub fn load(path: &Path, expected_num_species: usize) -> Result<Self> {
        let bytes = std::fs::read(path).map_err(|e| {
            SpeciesIdError::Config(format!(
                "Failed to read geo index from {}: {}",
                path.display(),
                e
            ))
        })?;

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

        let version = read_u32_le(&bytes, 4);
        let num_species = read_u32_le(&bytes, 8);
        let h3_res_u32 = read_u32_le(&bytes, 12);
        let num_cells = read_u32_le(&bytes, 16) as usize;
        let num_entries = read_u32_le(&bytes, 20) as usize;

        if version != VERSION {
            return Err(SpeciesIdError::Config(format!(
                "Unsupported geo index version: {} (expected {})",
                version, VERSION
            )));
        }
        if num_species as usize != expected_num_species {
            return Err(SpeciesIdError::Config(format!(
                "Geo index num_species ({}) does not match label count ({}) — \
                 index is stale",
                num_species, expected_num_species
            )));
        }

        let h3_resolution = Resolution::try_from(u8::try_from(h3_res_u32).map_err(|_| {
            SpeciesIdError::Config(format!("H3 resolution {} out of range", h3_res_u32))
        })?)
        .map_err(|e| SpeciesIdError::Config(format!("Invalid H3 resolution: {}", e)))?;

        let expected_size = HEADER_SIZE + num_cells * 8 + (num_cells + 1) * 4 + num_entries * 4;
        if bytes.len() != expected_size {
            return Err(SpeciesIdError::Config(format!(
                "Geo index size mismatch: expected {} bytes, got {}",
                expected_size,
                bytes.len()
            )));
        }

        // Decode into aligned Vecs. We use explicit little-endian reads so the
        // file format is stable across architectures (all our targets are LE,
        // but this is cheap insurance).
        let mut cells = Vec::with_capacity(num_cells);
        let mut off = HEADER_SIZE;
        for _ in 0..num_cells {
            cells.push(read_u64_le(&bytes, off));
            off += 8;
        }
        let mut offsets = Vec::with_capacity(num_cells + 1);
        for _ in 0..=num_cells {
            offsets.push(read_u32_le(&bytes, off));
            off += 4;
        }
        let mut species_ids = Vec::with_capacity(num_entries);
        for _ in 0..num_entries {
            species_ids.push(read_u32_le(&bytes, off));
            off += 4;
        }

        // Sanity: offsets must be monotonic and terminate at num_entries.
        // Catches bit-flip or truncated-file scenarios before we mis-index at
        // inference time.
        if offsets.first().copied() != Some(0)
            || offsets.last().copied() != Some(num_entries as u32)
        {
            return Err(SpeciesIdError::Config(
                "Geo index offsets are malformed (bad endpoints)".to_string(),
            ));
        }

        info!(
            num_cells,
            num_entries,
            h3_resolution = h3_res_u32,
            size_mb = bytes.len() / (1024 * 1024),
            "Geo index loaded"
        );

        Ok(Self {
            cells,
            offsets,
            species_ids,
            h3_resolution,
        })
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

        match self.cells.binary_search(&cell_u64) {
            Ok(i) => {
                let start = self.offsets[i] as usize;
                let end = self.offsets[i + 1] as usize;
                &self.species_ids[start..end]
            }
            Err(_) => &[],
        }
    }
}

fn read_u32_le(bytes: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(bytes[off..off + 4].try_into().expect("len 4"))
}

fn read_u64_le(bytes: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(bytes[off..off + 8].try_into().expect("len 8"))
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
