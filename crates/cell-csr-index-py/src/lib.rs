//! PyO3 bindings for [`cell_csr_index`].
//!
//! Exposes the Rust reader of the `OGI1` H3-cell → `u32`-ID index to Python so
//! a producer/verifier (e.g. the `bioclip-models` pipeline, which writes the
//! format) can read it back through the exact same code the production service
//! uses, instead of maintaining a parallel hand-rolled parser.
//!
//! ```python
//! from cell_csr_index import CellCsrIndex
//!
//! idx = CellCsrIndex.load("species_geo_index.bin", expected_count=None)
//! print(idx.count, idx.resolution, idx.num_cells, idx.num_entries)
//! ids = idx.ids_at(37.77, -122.42)   # -> list[int]
//! ```

use std::path::PathBuf;

use index_core::CellCsrIndex;
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

/// Read-only handle to an mmap'd `OGI1` cell→ID index.
#[pyclass(name = "CellCsrIndex", frozen)]
struct PyCellCsrIndex {
    inner: CellCsrIndex,
}

#[pymethods]
impl PyCellCsrIndex {
    /// Load an index file.
    ///
    /// `expected_count`, if given, must equal the index's declared `count`
    /// (raises `ValueError` otherwise) — use it to catch an index that is
    /// stale relative to the data its IDs reference.
    #[staticmethod]
    #[pyo3(signature = (path, expected_count=None))]
    fn load(path: PathBuf, expected_count: Option<usize>) -> PyResult<Self> {
        CellCsrIndex::load(&path, expected_count)
            .map(|inner| Self { inner })
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }

    /// IDs associated with the H3 cell covering `(lat, lon)`.
    ///
    /// Returns an empty list if the coordinates are invalid, the cell is not in
    /// the index, or the cell has no mapped IDs.
    fn ids_at(&self, lat: f64, lon: f64) -> Vec<u32> {
        // Copies out of the mmap: a borrowed `&[u32]` can't outlive the call
        // on the Python side. Cell ID lists are small, so this is cheap.
        self.inner.ids_at(lat, lon).to_vec()
    }

    /// Number of distinct IDs the index was built for (header `count`).
    #[getter]
    fn count(&self) -> usize {
        self.inner.count()
    }

    /// H3 resolution the cells are indexed at.
    #[getter]
    fn resolution(&self) -> u8 {
        self.inner.resolution()
    }

    /// Number of distinct H3 cells in the index.
    #[getter]
    fn num_cells(&self) -> usize {
        self.inner.num_cells()
    }

    /// Total number of `(cell, id)` entries.
    #[getter]
    fn num_entries(&self) -> usize {
        self.inner.num_entries()
    }

    fn __repr__(&self) -> String {
        format!(
            "CellCsrIndex(count={}, resolution={}, num_cells={}, num_entries={})",
            self.inner.count(),
            self.inner.resolution(),
            self.inner.num_cells(),
            self.inner.num_entries(),
        )
    }
}

// The Rust fn name differs from the Python module name to avoid clashing with
// the `index_core` crate; `#[pyo3(name)]` fixes the exported module + the
// generated `PyInit_cell_csr_index` symbol.
#[pymodule]
#[pyo3(name = "cell_csr_index")]
fn py_module(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyCellCsrIndex>()?;
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    Ok(())
}
