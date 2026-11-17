#!/bin/sh
# Build the site for one origin and stage its Docker context (deploy/Dockerfile).
#   WEB_ORIGIN=https://next.observ.ing [APPVIEW=https://observ.ing] exact/deploy/stage.sh <out dir>
# The site calls APPVIEW directly and signs in there; WEB_ORIGIN is where it is
# served, which Exact needs to grant its sign-in callback page. The appview has
# to name WEB_ORIGIN in CORS_ORIGINS and <WEB_ORIGIN>/.exact/auth/callback in
# APP_REDIRECT_URIS.
set -eu
: "${WEB_ORIGIN:?set WEB_ORIGIN}"
APPVIEW=${APPVIEW:-https://observ.ing}
out=${1:?usage: stage.sh <out dir>}
app=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)

cd "$app"
OBSERVING_API="$APPVIEW" OBSERVING_AUTH_ORIGIN="$APPVIEW" OBSERVING_WEB_ORIGIN="$WEB_ORIGIN" \
  bun exact.mjs web-build --out "$out/dist"
cp deploy/site.ts "$out/site.ts"
cp deploy/Dockerfile "$out/Dockerfile"
