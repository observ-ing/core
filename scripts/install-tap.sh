#!/usr/bin/env bash
# Install the upstream `tap` Go binary at the indigo revision CI and the
# production Dockerfile build against. Safe to re-run.
#
# Usage: ./scripts/install-tap.sh

set -euo pipefail

# Keep in sync with .github/workflows/ci.yml (the `Build and install
# upstream tap` step) and the tap-build stage in Dockerfile.
INDIGO_REV="ce62b8fce9e01434213a69cb251852b2c9436cb9"

if ! command -v go >/dev/null 2>&1; then
  echo "Error: Go is not installed. Install Go 1.26+ from https://go.dev/dl/" >&2
  exit 1
fi

echo "Installing tap from github.com/bluesky-social/indigo@${INDIGO_REV}..."
GODEBUG=netdns=go go install "github.com/bluesky-social/indigo/cmd/tap@${INDIGO_REV}"

GOBIN_DIR="$(go env GOBIN)"
[ -z "$GOBIN_DIR" ] && GOBIN_DIR="$(go env GOPATH)/bin"

if command -v tap >/dev/null 2>&1; then
  echo "Done: tap installed at $(command -v tap)"
else
  cat >&2 <<EOF
tap was built and dropped at ${GOBIN_DIR}/tap, but that directory is
not on your PATH. Add this to your shell rc:

  export PATH="${GOBIN_DIR}:\$PATH"

Then re-open your shell.
EOF
  exit 1
fi
