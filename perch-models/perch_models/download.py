"""Download prebuilt Perch 2.0 ONNX bundle and class list from HuggingFace.

Default source: https://huggingface.co/justinchuby (community ONNX exports).
Justin Chu's bundle expects raw mono float32 PCM at 32 kHz, shape
[batch, 160000], and outputs class logits over the full Perch 2.0 head
(~14,795 species + ~200 general sound events).

Requires the `download` extra: pip install -e '.[download]'
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

# Pinned to specific revisions so reruns are deterministic. Bump when a new
# ONNX export passes verify + a smoke eval; chasing `main` silently shifts
# model behavior under the appview.
PERCH_ONNX_REPO: Final[str] = "justinchuby/perch-2.0-onnx"
PERCH_ONNX_REVISION: Final[str] = "main"  # TODO pin once we settle on a revision
PERCH_ONNX_FILE: Final[str] = "perch_v2.onnx"
PERCH_LABELS_FILE: Final[str] = "labels.csv"


def download_bundle(output_dir: Path) -> tuple[Path, Path]:
    """Fetch the ONNX model + class list to `output_dir`.

    Returns (onnx_path, labels_csv_path).
    """
    from huggingface_hub import hf_hub_download

    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading Perch ONNX from {PERCH_ONNX_REPO}@{PERCH_ONNX_REVISION}...")
    onnx_path = Path(
        hf_hub_download(
            repo_id=PERCH_ONNX_REPO,
            filename=PERCH_ONNX_FILE,
            revision=PERCH_ONNX_REVISION,
            local_dir=str(output_dir),
        )
    )
    size_mb = onnx_path.stat().st_size / (1024 * 1024)
    print(f"  Saved {onnx_path.name} ({size_mb:.0f} MB)")

    print(f"Downloading class list from {PERCH_ONNX_REPO}...")
    labels_csv = Path(
        hf_hub_download(
            repo_id=PERCH_ONNX_REPO,
            filename=PERCH_LABELS_FILE,
            revision=PERCH_ONNX_REVISION,
            local_dir=str(output_dir),
        )
    )
    print(f"  Saved {labels_csv.name}")

    # The Rust service expects the encoder file at audio_encoder.onnx —
    # rename to the canonical layout so it can be dropped into models/perch/.
    canonical = output_dir / "audio_encoder.onnx"
    if onnx_path.name != canonical.name:
        onnx_path.replace(canonical)
        onnx_path = canonical

    return onnx_path, labels_csv
