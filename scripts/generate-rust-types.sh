#!/usr/bin/env bash
set -euo pipefail

# Generate Rust AT Protocol types from lexicon schemas using jacquard-codegen.
#
# Prerequisites:
#   cargo install jacquard-lexgen
#
# Usage:
#   ./scripts/generate-rust-types.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT_DIR="$ROOT_DIR/lexicons"
OUTPUT_DIR="$ROOT_DIR/crates/observing-lexicons/src"

# Try to find jacquard-codegen on PATH or in ~/.cargo/bin
JACQUARD_CODEGEN="jacquard-codegen"
if ! command -v "$JACQUARD_CODEGEN" &>/dev/null; then
  if [ -x "$HOME/.cargo/bin/jacquard-codegen" ]; then
    JACQUARD_CODEGEN="$HOME/.cargo/bin/jacquard-codegen"
  else
    echo "Error: jacquard-codegen not found. Install with: cargo install jacquard-lexgen"
    exit 1
  fi
fi

echo "Generating Rust types from lexicons..."
echo "  Input:  $INPUT_DIR"
echo "  Output: $OUTPUT_DIR"

"$JACQUARD_CODEGEN" --input "$INPUT_DIR" --output "$OUTPUT_DIR"

echo "Rust types generated successfully!"
