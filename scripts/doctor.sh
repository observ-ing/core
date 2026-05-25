#!/usr/bin/env bash
# Diagnose the local development environment. Read-only: checks every
# prerequisite, dependency, and runtime resource the stack needs and
# prints a pass/fail line for each. Exits non-zero if anything failed.
#
# Usage: ./scripts/doctor.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [ -t 1 ]; then
  GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; RED=$'\033[0;31m'
  BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; RESET=''
fi

# Pull in .env if present so DATABASE_URL, MODEL_DIR, ORT_DYLIB_PATH,
# etc. resolve the same way they will for cargo / process-compose.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
fi

failures=0

section() { printf "\n%s%s%s\n" "$BOLD" "$1" "$RESET"; }
pass()    { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn()    { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
fail()    { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1"; failures=$((failures + 1)); }

# ---- Toolchain ------------------------------------------------------------

section "Toolchain"

if command -v node >/dev/null 2>&1; then
  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$node_major" -ge 24 ]; then
    pass "Node $(node -v)"
  else
    fail "Node $(node -v) is too old; need 24+ (package.json engines.node)"
  fi
else
  fail "node not installed"
fi

if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
  rust_version=$(rustc --version 2>/dev/null | awk '{print $2}')
  expected_channel=$(grep -E '^channel' rust-toolchain.toml 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/')
  if [ -n "$expected_channel" ] && [[ "$rust_version" == "$expected_channel"* ]]; then
    pass "Rust $rust_version (matches rust-toolchain.toml: $expected_channel)"
  else
    warn "Rust $rust_version installed; rust-toolchain.toml pins ${expected_channel:-?} (rustup auto-switches on cargo run)"
  fi
else
  fail "Rust not installed (https://rustup.rs)"
fi

if command -v process-compose >/dev/null 2>&1; then
  pass "process-compose on PATH"
else
  fail "process-compose not installed (https://github.com/F1bonacc1/process-compose)"
fi

if command -v go >/dev/null 2>&1; then
  pass "Go $(go version | awk '{print $3}')"
else
  warn "Go not installed (only needed to build the tap binary from source)"
fi

# ---- Project state --------------------------------------------------------

section "Project state"

if [ -f .env ]; then
  pass ".env present"
else
  fail ".env missing — run: cp .env.example .env"
fi

if [ -d node_modules ]; then
  pass "node_modules present"
else
  fail "node_modules missing — run: npm install"
fi

# ---- Tap binary -----------------------------------------------------------

section "Tap binary"
if command -v tap >/dev/null 2>&1; then
  pass "tap on PATH: $(command -v tap)"
else
  fail "tap not on PATH — run: ./scripts/install-tap.sh"
fi

# ---- BioCLIP models -------------------------------------------------------

section "BioCLIP models"
model_dir="${MODEL_DIR:-./models/bioclip}"
if [ -f "$model_dir/vision_encoder.onnx" ]; then
  pass "Models present in $model_dir"
else
  fail "Models missing — run: ./scripts/download-models.sh"
fi

# ---- ONNX Runtime ---------------------------------------------------------

section "ONNX Runtime"
ort_path="${ORT_DYLIB_PATH:-}"
if [ -z "$ort_path" ]; then
  case "$(uname -s)" in
    Darwin) ort_path="/opt/homebrew/lib/libonnxruntime.dylib" ;;
    Linux)  ort_path="/usr/lib/x86_64-linux-gnu/libonnxruntime.so" ;;
    *)      ort_path="" ;;
  esac
fi
if [ -n "$ort_path" ] && [ -f "$ort_path" ]; then
  pass "ONNX Runtime: $ort_path"
elif [ -n "$ort_path" ]; then
  fail "ONNX Runtime missing at $ort_path — brew install onnxruntime (macOS) or your distro's libonnxruntime package"
else
  warn "Unknown platform — set ORT_DYLIB_PATH in .env"
fi

# ---- Postgres -------------------------------------------------------------

section "Postgres"
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -q -h localhost -p 5432 2>/dev/null; then
    pass "Postgres reachable on localhost:5432"
    pg_reachable=1
  else
    fail "Postgres not reachable on localhost:5432"
    pg_reachable=0
  fi
elif command -v nc >/dev/null 2>&1; then
  if nc -z localhost 5432 2>/dev/null; then
    pass "Something is listening on localhost:5432 (install postgresql-client for a deeper check)"
    pg_reachable=1
  else
    fail "Nothing listening on localhost:5432"
    pg_reachable=0
  fi
else
  warn "Can't probe Postgres (neither pg_isready nor nc available)"
  pg_reachable=0
fi

if [ "$pg_reachable" = "1" ] && command -v psql >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  postgis=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM pg_extension WHERE extname='postgis'" 2>/dev/null || true)
  if [ "$postgis" = "1" ]; then
    pass "PostGIS extension installed"
  else
    fail "PostGIS extension not installed in DATABASE_URL (or DATABASE_URL is wrong)"
  fi
elif [ "$pg_reachable" = "1" ] && [ -z "${DATABASE_URL:-}" ]; then
  warn "DATABASE_URL not set — skipping PostGIS check"
fi

# ---- Ports ----------------------------------------------------------------

section "Ports"
check_port() {
  local port=$1 name=$2
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
      warn "Port $port (would host $name) is in use"
    else
      pass "Port $port free (for $name)"
    fi
  else
    warn "Port $port (skipped — lsof not available)"
  fi
}
check_port 3000 appview
check_port 3005 species-id
check_port 5173 vite
check_port 8080 tap-ingester

# ---- Summary --------------------------------------------------------------

section "Summary"
if [ "$failures" -eq 0 ]; then
  printf "%sAll checks passed.%s You should be able to run \`process-compose up -D\`.\n" "$GREEN" "$RESET"
  exit 0
else
  printf "%s%d failed check(s) above.%s Fix the items marked %s✗%s, then re-run.\n" \
    "$RED" "$failures" "$RESET" "$RED" "$RESET"
  exit 1
fi
