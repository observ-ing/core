#!/bin/sh
# Load lexicon JSON files into QuickSlice's lexicon table.
# Runs as a one-shot init container after QuickSlice's Postgres is ready.
# Uses only tools available in postgres:16-alpine (sh, psql, sed).

set -e

LEXICON_DIR="/lexicons"

echo "Waiting for QuickSlice lexicon table to exist..."
for i in $(seq 1 30); do
  if psql -c "SELECT 1 FROM lexicon LIMIT 0" >/dev/null 2>&1; then
    break
  fi
  echo "  waiting for schema... ($i/30)"
  sleep 2
done

echo "Loading lexicons from $LEXICON_DIR..."

find "$LEXICON_DIR" -name "*.json" -type f | while read -r file; do
  # Extract the lexicon ID (first "id" field in JSON)
  id=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -1)

  if [ -z "$id" ]; then
    echo "  SKIP (no id): $file"
    continue
  fi

  # Skip non-record types (check for "type": "record" in defs.main)
  if ! grep -q '"type"[[:space:]]*:[[:space:]]*"record"' "$file"; then
    echo "  SKIP (not a record): $id"
    continue
  fi

  echo "  Loading: $id"

  # Read file, escape single quotes for SQL, insert via psql stdin
  content=$(cat "$file" | tr -d '\n' | sed "s/'/''/g")
  printf "INSERT INTO lexicon (id, json, created_at) VALUES ('%s', '%s', NOW()) ON CONFLICT (id) DO UPDATE SET json = EXCLUDED.json;\n" "$id" "$content" | psql -q
done

echo "Lexicons loaded successfully."
