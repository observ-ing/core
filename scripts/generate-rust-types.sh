#!/usr/bin/env bash
set -euo pipefail

# Generate Rust AT Protocol types from lexicon schemas using jacquard-codegen.
#
# Usage:
#   ./scripts/generate-rust-types.sh

JACQUARD_LEXGEN_VERSION="0.9.5"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT_DIR="$ROOT_DIR/lexicons"
OUTPUT_DIR="$ROOT_DIR/crates/observing-lexicons/src"

# Ensure the pinned version of jacquard-codegen is installed
if ! command -v jacquard-codegen &>/dev/null; then
  echo "Installing jacquard-lexgen@${JACQUARD_LEXGEN_VERSION}..."
  cargo install "jacquard-lexgen@${JACQUARD_LEXGEN_VERSION}"
else
  INSTALLED_VERSION=$(jacquard-codegen --version | awk '{print $2}')
  if [ "$INSTALLED_VERSION" != "$JACQUARD_LEXGEN_VERSION" ]; then
    echo "Updating jacquard-lexgen from $INSTALLED_VERSION to $JACQUARD_LEXGEN_VERSION..."
    cargo install "jacquard-lexgen@${JACQUARD_LEXGEN_VERSION}"
  fi
fi

echo "Generating Rust types from lexicons..."
echo "  Input:  $INPUT_DIR"
echo "  Output: $OUTPUT_DIR"

jacquard-codegen --input "$INPUT_DIR" --output "$OUTPUT_DIR"

echo "Rust types generated successfully!"
