"""Smoke tests for the cell_csr_index PyO3 bindings.

Run after building the extension into the current environment:

    pip install maturin
    maturin develop -m crates/cell-csr-index-py/Cargo.toml
    pytest crates/cell-csr-index-py/tests/

Requires Python >= 3.11 (the wheel targets the abi3-py311 stable ABI).

These exercise the *binding* layer (load, metadata getters, error mapping,
return types). Positive `ids_at` lookups against real H3 cells are covered by
the Rust crate's own unit tests, which compute cells via `h3o`.
"""

import struct

import pytest

import cell_csr_index as cci

MAGIC = b"OGI1"
VERSION = 1


def write_index(path, count, resolution, cells_and_ids):
    """Write a minimal OGI1 file. Mirrors bioclip_models/geo.py."""
    num_cells = len(cells_and_ids)
    num_entries = sum(len(ids) for _, ids in cells_and_ids)

    buf = bytearray()
    buf += MAGIC
    buf += struct.pack(
        "<7I", VERSION, count, resolution, num_cells, num_entries, 0, 0
    )
    for cell, _ in cells_and_ids:
        buf += struct.pack("<Q", cell)
    offset = 0
    buf += struct.pack("<I", offset)
    for _, ids in cells_and_ids:
        offset += len(ids)
        buf += struct.pack("<I", offset)
    for _, ids in cells_and_ids:
        for i in ids:
            buf += struct.pack("<I", i)

    path.write_bytes(bytes(buf))


def test_loads_and_exposes_metadata(tmp_path):
    path = tmp_path / "index.bin"
    # Arbitrary cell value: metadata + ids_at type are what we assert here.
    write_index(path, count=7, resolution=4, cells_and_ids=[(0x1234_5678, [1, 4, 5])])

    idx = cci.CellCsrIndex.load(str(path))
    assert idx.count == 7
    assert idx.resolution == 4
    assert idx.num_cells == 1
    assert idx.num_entries == 3
    assert "CellCsrIndex" in repr(idx)


def test_ids_at_returns_list(tmp_path):
    path = tmp_path / "index.bin"
    write_index(path, count=3, resolution=4, cells_and_ids=[])

    idx = cci.CellCsrIndex.load(str(path))
    result = idx.ids_at(0.0, 0.0)
    assert isinstance(result, list)
    assert result == []  # empty index -> no cell matches


def test_expected_count_mismatch_raises(tmp_path):
    path = tmp_path / "index.bin"
    write_index(path, count=100, resolution=4, cells_and_ids=[])

    # Matching count is fine.
    cci.CellCsrIndex.load(str(path), expected_count=100)
    # A mismatch (stale index) maps to a Python ValueError.
    with pytest.raises(ValueError):
        cci.CellCsrIndex.load(str(path), expected_count=999)


def test_bad_magic_raises(tmp_path):
    path = tmp_path / "index.bin"
    path.write_bytes(b"XXXX" + b"\x00" * 28)
    with pytest.raises(ValueError):
        cci.CellCsrIndex.load(str(path))
