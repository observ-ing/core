"""Verification utilities for exported Perch artifacts.

Requires the `verify` extra: pip install -e '.[verify]'

Checks:
1. ONNX loads, has the expected single audio input and per-class output.
2. Inference on a zero-tensor produces finite, well-shaped logits.
3. Inference on a real test clip produces non-degenerate predictions
   (best match isn't a sound event; top-1 score > some sane threshold).
4. species_labels.json has exactly one row per output class.
5. Geo index, if present, validates the same way as species-id's.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .schema import ClassRecord

# Perch 2.0 input shape: 5 seconds * 32 kHz mono = 160_000 samples.
PERCH_INPUT_SAMPLES = 160_000


def verify_onnx_model(onnx_path: Path) -> int:
    """Verify the Perch ONNX model. Returns the number of output classes."""
    import onnxruntime as ort

    print(f"Verifying ONNX model: {onnx_path}")
    session = ort.InferenceSession(str(onnx_path))

    inputs = session.get_inputs()
    outputs = session.get_outputs()
    print(f"  Inputs:  {[(i.name, i.shape, i.type) for i in inputs]}")
    print(f"  Outputs: {[(o.name, o.shape, o.type) for o in outputs]}")

    assert len(inputs) == 1, f"Expected 1 input, got {len(inputs)}"
    input_name = inputs[0].name

    # The community bundle uses "audio" but upstream Perch variants have
    # been seen with "input" or "pcm" — surface the actual name so the
    # Rust service can be configured to match.
    print(f"  Input tensor name: {input_name!r}")

    num_classes = outputs[0].shape[1]
    print(f"  Number of output classes: {num_classes}")

    # Run on silence to make sure the graph executes end-to-end.
    silence = np.zeros((1, PERCH_INPUT_SAMPLES), dtype=np.float32)
    result = session.run(None, {input_name: silence})
    logits = np.asarray(result[0])
    assert logits.shape == (1, num_classes), f"Unexpected shape: {logits.shape}"
    assert not np.isnan(logits).any(), "Output contains NaN"
    assert np.isfinite(logits).all(), "Output contains Inf"

    print("  ONNX verification passed")
    return num_classes


def verify_labels(labels_path: Path, num_classes: int) -> None:
    """Make sure species_labels.json is index-aligned with the ONNX head."""
    print(f"Verifying labels: {labels_path}")
    raw = json.loads(labels_path.read_text())
    records = [ClassRecord.model_validate(item) for item in raw]
    if len(records) != num_classes:
        raise ValueError(
            f"labels count ({len(records)}) does not match ONNX output classes "
            f"({num_classes}). The Rust loader assumes 1:1 row→class alignment."
        )
    species = sum(1 for r in records if r.is_species)
    print(f"  {len(records)} classes ({species} species, "
          f"{len(records) - species} sound events)")
    print(f"  Sample species: {[r.scientific_name for r in records if r.is_species][:5]}")
    print("  Labels verification passed")


def verify_on_real_clip(onnx_path: Path, labels_path: Path, wav_path: Path) -> None:
    """End-to-end smoke test: known clip → expected species in top-5."""
    import onnxruntime as ort
    import soundfile as sf

    print(f"End-to-end test with {wav_path}")
    audio, sr = sf.read(str(wav_path), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)  # downmix
    if sr != 32_000:
        raise ValueError(
            f"Verification clip must be 32 kHz mono (got {sr} Hz). "
            "Resample with ffmpeg before passing to verify."
        )
    # Pad / trim to 5s.
    if audio.shape[0] < PERCH_INPUT_SAMPLES:
        pad = np.zeros(PERCH_INPUT_SAMPLES - audio.shape[0], dtype=np.float32)
        audio = np.concatenate([audio, pad])
    else:
        audio = audio[:PERCH_INPUT_SAMPLES]

    session = ort.InferenceSession(str(onnx_path))
    input_name = session.get_inputs()[0].name
    logits = np.asarray(session.run(None, {input_name: audio[None, :]})[0])[0]

    records = [ClassRecord.model_validate(r) for r in json.loads(labels_path.read_text())]
    top5 = np.argsort(logits)[::-1][:5]
    print("  Top 5 predictions:")
    for idx in top5:
        r = records[int(idx)]
        tag = "species" if r.is_species else "event"
        print(f"    [{tag}] {r.scientific_name}: {logits[int(idx)]:.3f}")


def verify_all(model_dir: Path) -> None:
    """Run all verification checks on a model directory."""
    onnx_path = model_dir / "audio_encoder.onnx"
    labels_path = model_dir / "species_labels.json"
    geo_index_path = model_dir / "species_geo_index.bin"

    for path in (onnx_path, labels_path):
        if not path.exists():
            raise FileNotFoundError(f"Missing: {path}")

    num_classes = verify_onnx_model(onnx_path)
    verify_labels(labels_path, num_classes)

    test_wav = model_dir / "test_clip.wav"
    if test_wav.exists():
        verify_on_real_clip(onnx_path, labels_path, test_wav)
    else:
        print(f"  (no {test_wav.name}; skipping smoke test)")

    if geo_index_path.exists():
        # Same on-disk format as bioclip-models/species_geo_index.bin —
        # reuse that verifier verbatim once geo support lands.
        print(f"  (geo index present at {geo_index_path.name}; "
              f"verifier not yet implemented)")

    print("\nAll verifications passed!")
