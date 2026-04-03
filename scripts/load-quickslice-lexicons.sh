#!/bin/sh
# Load lexicon JSON files into QuickSlice's lexicon table.
#
# Postgres connection: uses PG* env vars (PGHOST, PGUSER, etc.) or DATABASE_URL.
# If DATABASE_URL is set and PG* vars are not, parses DATABASE_URL for psql.

set -e

# If DATABASE_URL is set but PGHOST is not, parse it for psql
if [ -n "$DATABASE_URL" ] && [ -z "$PGHOST" ]; then
  export PGDATABASE=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
  export PGUSER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
  export PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  SOCKET_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*[?&]host=\([^&]*\).*|\1|p')
  if [ -n "$SOCKET_HOST" ]; then
    export PGHOST="$SOCKET_HOST"
  else
    export PGHOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
  fi
fi

echo "Waiting for lexicon table to exist..."
for i in $(seq 1 30); do
  if psql -c "SELECT 1 FROM lexicon LIMIT 0" >/dev/null 2>&1; then
    echo "lexicon table ready"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "Timed out waiting for lexicon table"
    exit 1
  fi
  sleep 1
done

LEXICON_DIR="${LEXICON_DIR:-/lexicons}"
COUNT=0

for f in $(find "$LEXICON_DIR" -name '*.json' -type f); do
  # Extract the lexicon ID from the "id" field
  ID=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -1)
  if [ -z "$ID" ]; then
    echo "SKIP (no id): $f"
    continue
  fi

  # Skip non-record types (e.g., strongRef, defs-only)
  if ! grep -q '"type"[[:space:]]*:[[:space:]]*"record"' "$f"; then
    echo "SKIP (not a record type): $ID"
    continue
  fi

  # Read file contents and escape single quotes for SQL
  CONTENT=$(cat "$f" | tr -d '\n' | sed "s/'/''/g")

  psql -c "INSERT INTO lexicon (id, json) VALUES ('$ID', '$CONTENT'::jsonb) ON CONFLICT (id) DO UPDATE SET json = EXCLUDED.json;" >/dev/null

  COUNT=$((COUNT + 1))
  echo "Loaded: $ID"
done

# Set domain_authority so our collections are treated as "local" by QuickSlice.
# Local collections ingest events from ALL DIDs on the firehose (not just
# users who have logged in via OAuth).
DOMAIN_AUTHORITY="${QUICKSLICE_DOMAIN_AUTHORITY:-org.rwell.test}"
psql -c "INSERT INTO config (key, value) VALUES ('domain_authority', '$DOMAIN_AUTHORITY') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;" >/dev/null
echo "Set domain_authority=$DOMAIN_AUTHORITY"

echo "Done. Loaded $COUNT lexicons."
