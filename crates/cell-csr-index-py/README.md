# cell-csr-index-py

PyO3 bindings for [`cell-csr-index`](../cell-csr-index) — read the `OGI1`
H3-cell → `u32`-ID index from Python through the same Rust code the production
service uses.

> **Spike.** This is a proof-of-concept binding. It compiles (`cargo check`)
> and ships a maturin config + pytest smoke tests, but wheels have not yet been
> built/distributed in CI. See "Status" below.

## Why

The `OGI1` format is currently parsed in three places: the Rust reader
(`cell-csr-index`) and two hand-rolled Python parsers in the `bioclip-models`
repo (`verify.py` and `tests/test_geo.py`, via `struct.unpack` +
`np.frombuffer`). This binding lets the Python side read the format through the
Rust reader, so verification exercises the real code path and the format has
one source of truth on the read side.

## Build & use

```bash
pip install maturin
maturin develop -m crates/cell-csr-index-py/Cargo.toml   # builds + installs into the active venv
```

```python
from cell_csr_index import CellCsrIndex

idx = CellCsrIndex.load("species_geo_index.bin", expected_count=num_labels)
idx.count, idx.resolution, idx.num_cells, idx.num_entries
ids = idx.ids_at(37.77, -122.42)   # list[int]
```

Requires Python >= 3.11 (the wheel targets the `abi3-py311` stable ABI, so one
wheel works across all CPython 3.11+).

## Tests

```bash
maturin develop -m crates/cell-csr-index-py/Cargo.toml
pytest crates/cell-csr-index-py/tests/
```

## Status / next steps

- The crate is **excluded from the root cargo workspace** (root `Cargo.toml`
  `[workspace] exclude`) because a PyO3 `extension-module` doesn't link
  libpython and would break the workspace-wide `cargo test --workspace`. Build
  it with maturin, not `cargo test`.
- Validated here with `cargo check` (headless, no Python needed thanks to
  `abi3`). The wheel itself was **not** built in this environment (`maturin`
  absent; local Python was 3.9 < 3.11).
- To productionize: add a maturin CI job to build/publish wheels for the target
  platform(s), then have `bioclip-models` depend on the wheel and replace its
  `struct.unpack` parsers in `verify.py` / `tests/test_geo.py`.
