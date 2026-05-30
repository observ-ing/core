#!/usr/bin/env bash
set -euo pipefail

# Regenerate everything downstream of the MLF lexicon sources.
#
# Pipeline:
#   lexicons-src/**/*.mlf   (source of truth, authored by hand)
#     │  mlf generate lexicon
#     ▼
#   lexicons/**/*.json      (generated AT Protocol JSON lexicons)
#     │  jacquard-codegen   (scripts/generate-rust-types.sh)
#     ▼
#   crates/observing-lexicons/src/**  (generated Rust types)
#
# MLF (https://mlf.lol) is "Matt's Lexicon Format", a human-friendly DSL
# for ATProto lexicons. We author the DSL and generate the JSON; the JSON
# stays committed because the frontend (LexiconView) and the Docker image
# consume it directly, and jacquard-codegen reads it to emit Rust types.
#
# Usage:
#   ./scripts/generate-lexicons.sh

# Pinned mlf revision (tangled.org/@stavola.xyz/mlf). Bump deliberately —
# the generated JSON must stay reproducible across machines and CI.
MLF_GIT="https://tangled.org/@stavola.xyz/mlf"
MLF_REV="a6d5e6f83564461af6a1af156b8815208ddb4255"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC_DIR="$ROOT_DIR/lexicons-src"
JSON_DIR="$ROOT_DIR/lexicons"

# Ensure the pinned mlf CLI is installed. We only need JSON generation, so
# build with --no-default-features (skips the TS/Go/Rust codegen plugins).
ensure_mlf() {
  if command -v mlf &>/dev/null && mlf check --help &>/dev/null; then
    return
  fi
  echo "Installing mlf (@stavola.xyz/mlf @ ${MLF_REV:0:12})..."
  # RUSTFLAGS="" guards against a repo-level rustflags that would break the
  # third-party build (mirrors how generate-rust-types.sh installs jacquard).
  RUSTFLAGS="" cargo install --git "$MLF_GIT" --rev "$MLF_REV" \
    --no-default-features mlf-cli
}

ensure_mlf

echo "Validating MLF sources in $SRC_DIR ..."
mlf check "$SRC_DIR"

echo "Generating JSON lexicons from MLF..."
echo "  Input:  $SRC_DIR"
echo "  Output: $JSON_DIR"
# Explicit -i/-o/--root rather than mlf.toml project mode: this repo owns
# multiple NSID roots (ing.observ.*, bio.lexicons.*) plus the vendored
# com.atproto.* standard type, and a single mlf.toml [package].name can only
# scope one of them. The explicit form derives each NSID from its path under
# --root and is namespace-agnostic.
mlf generate lexicon -i "$SRC_DIR" -o "$JSON_DIR" --root "$SRC_DIR"

echo "Generating Rust types from JSON lexicons..."
"$SCRIPT_DIR/generate-rust-types.sh"

echo "Lexicons regenerated successfully!"
echo "Remember to run: cargo fmt -p observing-lexicons"
