#!/usr/bin/env bash
# Bootstrap a local development environment. Idempotent — safe to re-run.
#
# Steps (each skipped if already done):
#   1. Verify Node / Rust / process-compose are installed
#   2. Copy .env.example to .env
#   3. npm install
#   4. Install the upstream `tap` Go binary (./scripts/install-tap.sh)
#   5. Download BioCLIP models (./scripts/download-models.sh)
#
# Postgres and migrations are intentionally out of scope: `process-compose
# up -D` brings up a managed postgis container and runs migrations
# automatically before the app services start.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [ -t 1 ]; then
  GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; RED=$'\033[0;31m'
  BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; RESET=''
fi

step() { printf "\n%s==> %s%s\n" "$BOLD" "$1" "$RESET"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
err()  { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1" >&2; }

# ---- 1. Prerequisites -----------------------------------------------------

step "Checking prerequisites"
missing=0

if command -v node >/dev/null 2>&1; then
  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$node_major" -ge 24 ]; then
    ok "Node $(node -v)"
  else
    err "Node $(node -v) is too old; need 24+"
    missing=1
  fi
else
  err "Node not installed (https://nodejs.org)"
  missing=1
fi

if command -v cargo >/dev/null 2>&1; then
  ok "$(rustc --version)"
else
  err "Rust not installed (https://rustup.rs)"
  missing=1
fi

if command -v process-compose >/dev/null 2>&1; then
  ok "process-compose"
else
  err "process-compose not installed (https://github.com/F1bonacc1/process-compose)"
  missing=1
fi

if [ "$missing" -ne 0 ]; then
  printf "\n%sInstall the prerequisites above, then re-run.%s\n" "$RED" "$RESET" >&2
  exit 1
fi

# ---- 2. .env --------------------------------------------------------------

step "Setting up .env"
if [ ! -f .env ]; then
  cp .env.example .env
  ok ".env created from .env.example"
  warn "Review .env and confirm DATABASE_URL / DB_PASSWORD match your Postgres setup."
else
  ok ".env already exists (not overwriting)"
fi

# Load .env so subsequent steps see DATABASE_URL, MODEL_DIR, etc.
set -a
# shellcheck disable=SC1091
source .env
set +a

# ---- 3. npm install -------------------------------------------------------

step "Installing npm dependencies"
npm install

# ---- 4. tap binary --------------------------------------------------------

step "Installing tap binary"
if command -v tap >/dev/null 2>&1; then
  ok "tap already on PATH: $(command -v tap)"
else
  "$SCRIPT_DIR/install-tap.sh"
fi

# ---- 5. Models ------------------------------------------------------------

step "Downloading BioCLIP models"
"$SCRIPT_DIR/download-models.sh"

# ---- Done -----------------------------------------------------------------

step "Setup complete"
cat <<EOF

Next steps:
  - Make sure Postgres is running on localhost:5432
    (see docs/development.md#database-setup)
  - process-compose up -D       # runs migrations, then starts services
  - open http://localhost:3000
  - Run ./scripts/doctor.sh anytime to diagnose problems
EOF
