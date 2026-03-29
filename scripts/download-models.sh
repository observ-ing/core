#!/usr/bin/env bash
# Download pre-built BioCLIP 2.5 model artifacts for the species-id service.
# Usage: ./scripts/download-models.sh

set -euo pipefail

MODEL_DIR="models/bioclip"
RELEASE_URL="https://github.com/observ-ing/bioclip-models/releases/download/v2.0.0/bioclip-2.5-models.tar.gz"

if [ -f "$MODEL_DIR/vision_encoder.onnx" ]; then
  echo "Models already present in $MODEL_DIR — skipping download."
  echo "Delete $MODEL_DIR to re-download."
  exit 0
fi

mkdir -p "$MODEL_DIR"
echo "Downloading BioCLIP 2.5 models (~1.4 GB compressed)..."
curl -L "$RELEASE_URL" | tar xz -C "$MODEL_DIR"
echo "Done. Models saved to $MODEL_DIR/"
ls -lh "$MODEL_DIR/"
