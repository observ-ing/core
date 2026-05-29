//! Zero-copy, mmap-backed index mapping [H3] cells to sorted lists of `u32`
//! IDs, with O(log n) point lookup.
//!
//! Given a latitude/longitude, [`CellCsrIndex::ids_at`] returns the IDs
//! associated with the H3 cell covering that point — useful for any
//! "what entities are relevant at this location?" lookup (species range maps,
//! points of interest, region/coverage membership, …).
//!
//! # Binary format
//!
//! The 4-byte magic is **caller-supplied** (passed to [`CellCsrIndex::load`]) —
//! it's the application's own file-type tag, so this crate doesn't bake one in.
//!
//! ```text
//! Header (32 bytes):
//!   magic[4]       = caller's 4-byte tag
//!   version        = u32 = 1   (this crate's layout version)
//!   count          = u32   (number of distinct IDs the index was built for;
//!                           optionally validated against the caller on load)
//!   h3_resolution  = u32   (typically 4)
//!   num_cells      = u32
//!   num_entries    = u32
//!   reserved       = u32 x 2
//!
//! Body:
//!   cells[num_cells]:      u64 LE  (H3 indices, sorted ascending)
//!   offsets[num_cells+1]:  u32 LE  (CSR offsets into ids)
//!   ids[num_entries]:      u32 LE
//! ```
//!
//! Lookup is O(log num_cells) via binary search over `cells`.
//!
//! The file is mmap'd rather than read into the heap. The format is
//! native-endian-compatible on little-endian targets, so [`bytemuck::cast_slice`]
//! gives zero-copy `&[u64]` / `&[u32]` views into the mmap'd region — only the
//! pages actually touched by a lookup are paged in by the OS.
//!
//! [H3]: https://h3geo.org

#[cfg(not(target_endian = "little"))]
compile_error!(
    "cell-csr-index uses a zero-copy reinterpret of LE u32/u64; the build target is big-endian"
);

use h3o::{LatLng, Resolution};
use memmap2::Mmap;
use std::fmt;
use std::fs::File;
use std::ops::Range;
use std::path::Path;
use tracing::info;

const VERSION: u32 = 1;
const HEADER_SIZE: usize = 32;

/// Error returned when loading or validating an index file.
#[derive(Debug)]
pub enum CellIndexError {
    /// The file could not be opened or mmap'd.
    Io(std::io::Error),
    /// The bytes are not a valid index (bad magic/version/size/offsets), or
    /// its declared `count` did not match the caller's expectation.
    Format(String),
}

impl fmt::Display for CellIndexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Format(msg) => write!(f, "invalid cell index: {msg}"),
        }
    }
}

impl std::error::Error for CellIndexError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::Format(_) => None,
        }
    }
}

type Result<T> = std::result::Result<T, CellIndexError>;

/// Parsed 32-byte header. Owns only the fields the body decode/validation path
/// cares about — the two reserved u32s are read and discarded.
struct Header {
    count: u32,
    h3_resolution: Resolution,
    num_cells: usize,
    num_entries: usize,
}

impl Header {
    /// Parse and validate magic, version, and resolution. Does *not* check the
    /// declared `count` or file size — those need additional context; see
    /// [`Header::validate_count`] and [`Header::expected_file_size`].
    fn parse(bytes: &[u8], magic: &[u8; 4]) -> Result<Self> {
        if bytes.len() < HEADER_SIZE {
            return Err(CellIndexError::Format(format!(
                "too short ({} bytes) to contain header",
                bytes.len()
            )));
        }
        if &bytes[..4] != magic {
            return Err(CellIndexError::Format(format!(
                "bad magic: expected {magic:?}, got {:?}",
                &bytes[..4]
            )));
        }

        let version = read_u32_le(bytes, 4);
        let count = read_u32_le(bytes, 8);
        let h3_res_u32 = read_u32_le(bytes, 12);
        let num_cells = read_u32_le(bytes, 16) as usize;
        let num_entries = read_u32_le(bytes, 20) as usize;

        if version != VERSION {
            return Err(CellIndexError::Format(format!(
                "unsupported version: {version} (expected {VERSION})"
            )));
        }

        let h3_resolution = Resolution::try_from(u8::try_from(h3_res_u32).map_err(|_| {
            CellIndexError::Format(format!("H3 resolution {h3_res_u32} out of range"))
        })?)
        .map_err(|e| CellIndexError::Format(format!("invalid H3 resolution: {e}")))?;

        Ok(Self {
            count,
            h3_resolution,
            num_cells,
            num_entries,
        })
    }

    /// Fail if the declared `count` disagrees with the caller's expectation —
    /// this signals the index is stale relative to whatever the IDs index into
    /// (e.g. a label set), so the IDs would point at the wrong rows.
    fn validate_count(&self, expected: usize) -> Result<()> {
        if self.count as usize != expected {
            return Err(CellIndexError::Format(format!(
                "count ({}) does not match expected ({}) — index is stale",
                self.count, expected
            )));
        }
        Ok(())
    }

    /// Total file size this header implies, used to detect truncation.
    fn expected_file_size(&self) -> usize {
        HEADER_SIZE + self.num_cells * 8 + (self.num_cells + 1) * 4 + self.num_entries * 4
    }
}

/// Sorted cell → ID lookup table, mmap'd from disk.
///
/// The three CSR arrays are byte ranges into `mmap`; [`cells`](Self::cells),
/// [`offsets`](Self::offsets), and [`ids`](Self::ids) reinterpret those ranges
/// as native-typed slices. Alignment is guaranteed by the file layout (the
/// header is 32 bytes; `cells` is u64-aligned at offset 32; `offsets` and `ids`
/// are u32-aligned by construction) plus mmap returning page-aligned addresses.
pub struct CellCsrIndex {
    mmap: Mmap,
    cells: Range<usize>,
    offsets: Range<usize>,
    ids: Range<usize>,
    h3_resolution: Resolution,
}

impl CellCsrIndex {
    /// Load the index from a file on disk via mmap.
    ///
    /// `magic` is the 4-byte file tag the index was written with; loading fails
    /// with [`CellIndexError::Format`] if the file doesn't start with it. The
    /// tag is the caller's choice — it identifies *your* index files.
    ///
    /// If `expected_count` is `Some`, the index's declared `count` must match
    /// it or loading fails with [`CellIndexError::Format`] — use this to catch
    /// an index that is stale relative to the data its IDs reference. Pass
    /// `None` to skip the check.
    pub fn load(path: &Path, magic: &[u8; 4], expected_count: Option<usize>) -> Result<Self> {
        let file = File::open(path).map_err(CellIndexError::Io)?;
        // SAFETY: the caller is responsible for ensuring the file is not
        // mutated while mapped (e.g. it is a read-only artifact). A concurrent
        // truncation could cause SIGBUS on access.
        let mmap = unsafe { Mmap::map(&file) }.map_err(CellIndexError::Io)?;

        let header = Header::parse(&mmap, magic)?;
        if let Some(expected) = expected_count {
            header.validate_count(expected)?;
        }

        let expected_size = header.expected_file_size();
        if mmap.len() != expected_size {
            return Err(CellIndexError::Format(format!(
                "size mismatch: expected {} bytes, got {}",
                expected_size,
                mmap.len()
            )));
        }

        let cells_start = HEADER_SIZE;
        let cells_end = cells_start + header.num_cells * 8;
        let offsets_start = cells_end;
        let offsets_end = offsets_start + (header.num_cells + 1) * 4;
        let ids_start = offsets_end;
        let ids_end = ids_start + header.num_entries * 4;

        // Validate the CSR endpoints directly against the mmap'd offsets array.
        // Catches bit-flips / adversarial inputs that pass the file-size check
        // but leave offsets malformed.
        let first_off = read_u32_le(&mmap, offsets_start);
        let last_off = read_u32_le(&mmap, offsets_end - 4);
        if first_off != 0 || last_off as usize != header.num_entries {
            return Err(CellIndexError::Format(
                "offsets are malformed (bad endpoints)".to_string(),
            ));
        }

        info!(
            num_cells = header.num_cells,
            num_entries = header.num_entries,
            h3_resolution = u8::from(header.h3_resolution),
            size_mb = mmap.len() / (1024 * 1024),
            "cell-csr-index mmap'd"
        );

        Ok(Self {
            mmap,
            cells: cells_start..cells_end,
            offsets: offsets_start..offsets_end,
            ids: ids_start..ids_end,
            h3_resolution: header.h3_resolution,
        })
    }

    fn cells(&self) -> &[u64] {
        bytemuck::cast_slice(&self.mmap[self.cells.clone()])
    }

    fn offsets(&self) -> &[u32] {
        bytemuck::cast_slice(&self.mmap[self.offsets.clone()])
    }

    fn ids(&self) -> &[u32] {
        bytemuck::cast_slice(&self.mmap[self.ids.clone()])
    }

    /// IDs associated with the H3 cell covering `(lat, lon)`.
    ///
    /// Returns an empty slice if the coordinates are invalid, the containing
    /// H3 cell is not in the index, or the cell has no mapped IDs.
    pub fn ids_at(&self, lat: f64, lon: f64) -> &[u32] {
        let Ok(latlng) = LatLng::new(lat, lon) else {
            return &[];
        };
        let cell_u64: u64 = latlng.to_cell(self.h3_resolution).into();

        match self.cells().binary_search(&cell_u64) {
            Ok(i) => {
                let offsets = self.offsets();
                let start = offsets[i] as usize;
                let end = offsets[i + 1] as usize;
                &self.ids()[start..end]
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

    /// Arbitrary 4-byte tag used by the test fixtures — the crate no longer
    /// bakes in a magic, so the tests pick their own.
    const MAGIC: &[u8; 4] = b"TST1";

    /// Build an in-memory index file with the CSR layout and write it to `path`.
    fn write_index(
        path: &Path,
        count: u32,
        resolution: Resolution,
        cells_and_ids: &[(u64, &[u32])],
    ) {
        let num_cells = cells_and_ids.len() as u32;
        let num_entries: u32 = cells_and_ids.iter().map(|(_, s)| s.len() as u32).sum();

        let mut buf = Vec::new();
        buf.extend_from_slice(MAGIC);
        buf.extend_from_slice(&VERSION.to_le_bytes());
        buf.extend_from_slice(&count.to_le_bytes());
        buf.extend_from_slice(&(u8::from(resolution) as u32).to_le_bytes());
        buf.extend_from_slice(&num_cells.to_le_bytes());
        buf.extend_from_slice(&num_entries.to_le_bytes());
        buf.extend_from_slice(&[0u8; 8]); // reserved

        for (cell, _) in cells_and_ids {
            buf.extend_from_slice(&cell.to_le_bytes());
        }
        let mut offset: u32 = 0;
        buf.extend_from_slice(&offset.to_le_bytes());
        for (_, ids) in cells_and_ids {
            offset += ids.len() as u32;
            buf.extend_from_slice(&offset.to_le_bytes());
        }
        for (_, ids) in cells_and_ids {
            for id in *ids {
                buf.extend_from_slice(&id.to_le_bytes());
            }
        }

        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&buf).unwrap();
    }

    #[test]
    fn load_and_lookup_roundtrip() {
        // Two real H3-4 cells, one for San Francisco and one for Salt Lake
        // City, covering different ID sets.
        let sf = LatLng::new(37.77, -122.42).unwrap();
        let slc = LatLng::new(40.76, -111.89).unwrap();
        let sf_cell: u64 = sf.to_cell(Resolution::Four).into();
        let slc_cell: u64 = slc.to_cell(Resolution::Four).into();

        let mut cells: Vec<(u64, &[u32])> = vec![(sf_cell, &[0, 2]), (slc_cell, &[1, 2])];
        cells.sort_by_key(|(c, _)| *c);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.bin");
        write_index(&path, 3, Resolution::Four, &cells);

        let index = CellCsrIndex::load(&path, MAGIC, Some(3)).unwrap();

        assert_eq!(index.ids_at(37.77, -122.42), &[0, 2]);
        assert_eq!(index.ids_at(40.76, -111.89), &[1, 2]);
        // A point nowhere near either cell returns empty.
        assert!(index.ids_at(0.0, 0.0).is_empty());
        // Out-of-range coordinates fail the LatLng constructor → empty.
        assert!(index.ids_at(91.0, 0.0).is_empty());
    }

    #[test]
    fn count_check_is_optional() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.bin");
        write_index(&path, 100, Resolution::Four, &[]);

        // Wrong expected count is rejected...
        assert!(CellCsrIndex::load(&path, MAGIC, Some(200)).is_err());
        // ...matching count is accepted...
        assert!(CellCsrIndex::load(&path, MAGIC, Some(100)).is_ok());
        // ...and None skips the check entirely.
        assert!(CellCsrIndex::load(&path, MAGIC, None).is_ok());
    }

    #[test]
    fn magic_is_caller_supplied() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.bin");
        write_index(&path, 1, Resolution::Four, &[]); // written with MAGIC ("TST1")

        // A different magic is rejected...
        match CellCsrIndex::load(&path, b"OTHR", Some(1)) {
            Err(e) => assert!(e.to_string().contains("magic"), "unexpected error: {e}"),
            Ok(_) => panic!("a different magic should be rejected"),
        }
        // ...the matching magic loads.
        assert!(CellCsrIndex::load(&path, MAGIC, Some(1)).is_ok());
    }

    #[test]
    fn rejects_stale_index_count_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.bin");
        write_index(&path, 100, Resolution::Four, &[]);

        let msg = match CellCsrIndex::load(&path, MAGIC, Some(200)) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("should reject stale index"),
        };
        assert!(msg.contains("stale"), "unexpected error: {msg}");
    }

    #[test]
    fn rejects_bad_magic() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.bin");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"XXXX").unwrap();
        f.write_all(&[0u8; 28]).unwrap();

        let msg = match CellCsrIndex::load(&path, MAGIC, Some(1)) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("should reject bad magic"),
        };
        assert!(msg.contains("magic"), "unexpected error: {msg}");
    }
}
