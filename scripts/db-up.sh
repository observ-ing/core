#!/usr/bin/env bash
# Start a local PostgreSQL + PostGIS for development. Idempotent — safe to
# re-run.
#
# Steps (each skipped if already done):
#   1. Read connection settings from .env (DATABASE_URL, else DB_* defaults)
#   2. If something already answers on the port, use it and exit
#   3. Otherwise start a postgis container, picking a native image per arch
#   4. Block until Postgres actually accepts connections
#
# The PostGIS extension is intentionally NOT created here — the first
# migration (crates/observing-db/migrations/20240101000000_initial.sql)
# does `CREATE EXTENSION IF NOT EXISTS postgis`, and process-compose runs
# migrations before any service reads the database.
#
# Usage:
#   ./scripts/db-up.sh              # start (or adopt) Postgres
#   ./scripts/db-up.sh --stop       # stop the container, keep the data
#   ./scripts/db-up.sh --destroy    # remove the container AND its data volume
#   ./scripts/db-up.sh --destroy -y # ...without the confirmation prompt

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

CONTAINER="${PG_CONTAINER_NAME:-observing-postgres}"
VOLUME="${PG_VOLUME_NAME:-observing-pgdata}"

# ---- Args -----------------------------------------------------------------

action="up"
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    --stop)        action="stop" ;;
    --destroy)     action="destroy" ;;
    -y|--yes)      assume_yes=1 ;;
    -h|--help)     sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "Unknown argument: $arg (try --help)"; exit 2 ;;
  esac
done

# ---- 1. Connection settings ----------------------------------------------

# Load .env the same way setup.sh and doctor.sh do, so this script and the
# rest of the stack can never disagree about where the database lives.
# `set -a; source .env` would overwrite an explicitly exported DATABASE_URL,
# so stash and restore it — an env var passed on the command line should win
# over the file, not the other way around.
_explicit_database_url="${DATABASE_URL:-}"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
fi
[ -n "$_explicit_database_url" ] && DATABASE_URL="$_explicit_database_url"

PG_USER="postgres"
PG_PASSWORD="${DB_PASSWORD:-mysecretpassword}"
PG_DB="observing"
PG_HOST="localhost"
PG_PORT="5432"

# Parse DATABASE_URL when present; it is the source of truth everywhere else
# in the stack (process-compose.yaml, migrate, appview, tap-ingester).
if [ -n "${DATABASE_URL:-}" ]; then
  rest="${DATABASE_URL#*://}"
  if [[ "$rest" == *"@"* ]]; then
    # Split on the LAST '@' so passwords containing '@' survive.
    userinfo="${rest%@*}"
    rest="${rest##*@}"
    [ -n "${userinfo%%:*}" ] && PG_USER="${userinfo%%:*}"
    if [[ "$userinfo" == *":"* ]]; then
      PG_PASSWORD="${userinfo#*:}"
    fi
  fi

  hostport="${rest%%/*}"
  if [ "$hostport" != "$rest" ]; then
    dbname="${rest#*/}"
    dbname="${dbname%%\?*}"
    [ -n "$dbname" ] && PG_DB="$dbname"
  fi

  if [ -n "$hostport" ]; then
    if [[ "$hostport" == *":"* ]]; then
      PG_HOST="${hostport%%:*}"
      PG_PORT="${hostport##*:}"
    else
      PG_HOST="$hostport"
    fi
  fi
fi

# Starting a local container for a remote DATABASE_URL would quietly shadow
# the database the rest of the stack talks to. Refuse instead.
case "$PG_HOST" in
  localhost|127.0.0.1|0.0.0.0|"") ;;
  *)
    err "DATABASE_URL points at a non-local host ($PG_HOST)."
    err "This script only manages a local Postgres. Nothing to do."
    exit 1
    ;;
esac

# ---- Stop / destroy -------------------------------------------------------

if [ "$action" = "stop" ]; then
  step "Stopping $CONTAINER"
  if docker stop "$CONTAINER" >/dev/null 2>&1; then
    ok "Stopped (data preserved in volume $VOLUME)"
  else
    warn "Container $CONTAINER is not running"
  fi
  exit 0
fi

if [ "$action" = "destroy" ]; then
  step "Destroying $CONTAINER and volume $VOLUME"
  if [ "$assume_yes" -ne 1 ]; then
    if [ -t 0 ]; then
      printf "  This permanently deletes all local database data. Continue? [y/N] "
      read -r reply
      case "$reply" in
        y|Y|yes|YES) ;;
        *) echo "  Aborted."; exit 0 ;;
      esac
    else
      err "Refusing to destroy data non-interactively without --yes"
      exit 1
    fi
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 && ok "Container removed" || warn "No container to remove"
  docker volume rm "$VOLUME" >/dev/null 2>&1 && ok "Volume removed" || warn "No volume to remove"
  exit 0
fi

# ---- 2. Adopt an existing Postgres ---------------------------------------

step "Checking for an existing Postgres on $PG_HOST:$PG_PORT"

port_answers() {
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q -h "$PG_HOST" -p "$PG_PORT" 2>/dev/null
  elif command -v nc >/dev/null 2>&1; then
    nc -z "$PG_HOST" "$PG_PORT" 2>/dev/null
  else
    return 1
  fi
}

if port_answers; then
  ok "Postgres already reachable on $PG_HOST:$PG_PORT — using it"
  echo
  echo "  Nothing to start. If this is a native install (Postgres.app,"
  echo "  Homebrew), make sure database '$PG_DB' exists and DATABASE_URL"
  echo "  in .env matches it. Run 'npm run doctor' to verify."
  exit 0
fi

ok "Port $PG_PORT is free"

# ---- 3. Docker preflight --------------------------------------------------

step "Checking Docker"

if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed."
  err "Install Docker Desktop (https://docs.docker.com/get-docker/), or set up"
  err "Postgres natively — see docs/development.md#database-setup."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  err "Docker is installed but the daemon isn't running."
  err "Start Docker Desktop (or your daemon) and re-run this script."
  exit 1
fi

ok "Docker daemon is running"

# The official postgis/postgis image publishes no arm64 manifest, so on Apple
# Silicon it runs under QEMU emulation and is markedly slower. imresamu/postgis
# is a drop-in multi-arch replacement with the same env vars.
#
# Pinned to 16-3.4 to match .github/workflows/ci.yml. Postgres 18+ images
# fatally refuse to start against the `-v $VOLUME:/var/lib/postgresql/data`
# mount below (docker-entrypoint.sh treats that path being its own mount
# point as leftover pre-18 data, regardless of what's actually in it), so
# an untagged/`:latest` pull breaks the moment either image's `latest` tag
# moves to 18. Override via POSTGIS_IMAGE if you want a different version.
case "$(uname -m)" in
  arm64|aarch64) IMAGE="${POSTGIS_IMAGE:-imresamu/postgis:16-3.4}" ;;
  *)             IMAGE="${POSTGIS_IMAGE:-postgis/postgis:16-3.4}" ;;
esac
ok "Image for $(uname -m): $IMAGE"

# ---- 4. Container lifecycle ----------------------------------------------

step "Starting Postgres"

state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "absent")"

case "$state" in
  running)
    # Port probe failed but the container is up: it is bound elsewhere.
    warn "Container $CONTAINER is running but nothing answers on $PG_PORT"
    warn "Check its port mapping: docker port $CONTAINER"
    ;;
  exited|created|paused)
    docker start "$CONTAINER" >/dev/null
    ok "Started existing container $CONTAINER"
    ;;
  *)
    docker run -d \
      --name "$CONTAINER" \
      -e POSTGRES_USER="$PG_USER" \
      -e POSTGRES_PASSWORD="$PG_PASSWORD" \
      -e POSTGRES_DB="$PG_DB" \
      -p "$PG_PORT:5432" \
      -v "$VOLUME:/var/lib/postgresql/data" \
      "$IMAGE" >/dev/null
    ok "Created container $CONTAINER (data volume: $VOLUME)"
    ;;
esac

# ---- 5. Wait for readiness -----------------------------------------------

# `docker run -d` returns long before Postgres accepts connections. Without
# this wait, a following `process-compose up -D` races the database and the
# one-shot migrate process fails.
step "Waiting for Postgres to accept connections"

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -q -U "$PG_USER" -d "$PG_DB" 2>/dev/null; then
    ok "Postgres is ready on $PG_HOST:$PG_PORT (database: $PG_DB)"
    cat <<EOF

Next steps:
  - process-compose up -D       # runs migrations, then starts services
  - open http://localhost:3000

  ./scripts/db-up.sh --stop     # stop, keeping data
  ./scripts/db-up.sh --destroy  # remove container and wipe data
EOF
    exit 0
  fi
  sleep 1
done

err "Postgres did not become ready within 60s."
err "Inspect the logs: docker logs $CONTAINER"
exit 1
