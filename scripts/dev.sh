#!/usr/bin/env bash
# Bring up the full local dev stack with a randomized port offset so several
# checkouts / git worktrees can run side by side without colliding on the
# usual 3000 / 3005 / 5173 / 8080 ports.
#
# A single random base offset is picked once and applied uniformly to every
# service, so their relative gaps (and therefore every cross-service URL the
# stack builds from them) stay intact. Postgres is intentionally left on its
# fixed port — it lives outside process-compose and is meant to be shared.
#
# Usage:
#   ./scripts/dev.sh                 # random offset, then `process-compose up`
#   ./scripts/dev.sh -D              # extra args are forwarded to process-compose
#   DEV_PORT_OFFSET=0 ./scripts/dev.sh   # pin the stock ports (no randomization)
#   DEV_PORT_OFFSET=2000 ./scripts/dev.sh  # pin a specific offset
#
# The derived ports are exported, so `process-compose.yaml` (and Vite, via the
# inherited environment) pick them up through their `${VAR:-default}` fallbacks.

set -euo pipefail

# Base ports, matching the defaults baked into process-compose.yaml.
BASE_APPVIEW_PORT=3000
BASE_SPECIES_ID_PORT=3005
BASE_VITE_PORT=5173
BASE_TAP_INGESTER_PORT=8080

# One random offset for the whole stack. Stepped by 10 and capped at 5000 so
# every derived port stays in a sane, unprivileged, in-range band and the
# services never overlap each other. Override DEV_PORT_OFFSET to pin it (0
# reproduces the stock ports).
if [[ -z "${DEV_PORT_OFFSET:-}" ]]; then
  DEV_PORT_OFFSET=$(( (RANDOM % 501) * 10 ))
fi

export APPVIEW_PORT=$(( BASE_APPVIEW_PORT + DEV_PORT_OFFSET ))
export SPECIES_ID_PORT=$(( BASE_SPECIES_ID_PORT + DEV_PORT_OFFSET ))
export VITE_PORT=$(( BASE_VITE_PORT + DEV_PORT_OFFSET ))
export TAP_INGESTER_PORT=$(( BASE_TAP_INGESTER_PORT + DEV_PORT_OFFSET ))

# Let the appview proxy and any direct `cargo run` find the relocated Vite.
export VITE_DEV_SERVER_URL="http://localhost:${VITE_PORT}"

cat <<EOF
Starting dev stack with port offset ${DEV_PORT_OFFSET}:
  appview        http://localhost:${APPVIEW_PORT}   (front door)
  species-id     http://localhost:${SPECIES_ID_PORT}
  tap-ingester   http://localhost:${TAP_INGESTER_PORT}
  vite           http://localhost:${VITE_PORT}
  postgres       localhost:5432   (fixed, shared)

Open the app at http://127.0.0.1:${APPVIEW_PORT}
EOF

exec process-compose up "$@"
