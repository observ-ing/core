#!/bin/sh
# Deploy the web app to Cloud Run, reading APPVIEW (default https://observ.ing).
#   PROJECT=<gcp project> [REGION=us-central1] [SERVICE=observing-exact] deploy/deploy.sh
# The site is built with its own URL as OBSERVING_API (server.ts there proxies
# the appview) and the appview as OBSERVING_AUTH_ORIGIN. Sign-in also needs
# <url>/.exact/auth/callback in the appview's APP_REDIRECT_URIS.
set -eu
: "${PROJECT:?set PROJECT}"
REGION=${REGION:-us-central1}
SERVICE=${SERVICE:-observing-exact}
APPVIEW=${APPVIEW:-https://observ.ing}
BUN=${BUN:-bun}
here=$(cd "$(dirname "$0")/.." && pwd)
number=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
url="https://$SERVICE-$number.$REGION.run.app"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

cd "$here"
OBSERVING_API="$url" OBSERVING_AUTH_ORIGIN="$APPVIEW" "$BUN" exact.mjs web-build --out "$stage/dist"
mkdir -p "$stage/fixtures"
cp server.ts app.ts exif.ts queue.ts fixture-key.ts "$stage/"
cp fixtures/api.json "$stage/fixtures/"
cp deploy/Dockerfile "$stage/Dockerfile"

# Built here and pushed, so the project needs no Cloud Build.
image="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE:$(date +%Y%m%d%H%M%S)"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null
docker build --platform linux/amd64 -t "$image" "$stage"
docker push "$image"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$image" \
  --allow-unauthenticated --set-env-vars "APPVIEW=$APPVIEW,OBSERVING_API=$url" \
  --cpu 1 --memory 256Mi --min-instances 0 --max-instances 2 --quiet
echo "$url"
echo "sign-in callback for the appview's APP_REDIRECT_URIS: $url/.exact/auth/callback"
