#!/bin/sh
# Deploy the site by hand to a Cloud Run service (CI's exact-deploy job deploys
# next.observ.ing from main). Builds here and pushes, so the project needs no
# Cloud Build.
#   PROJECT=<gcp project> WEB_ORIGIN=<the URL it will be served at> \
#     [REGION=us-central1] [SERVICE=observing-exact] [APPVIEW=https://observ.ing] exact/deploy/deploy.sh
# A new service's run.app URL is https://<SERVICE>-<project number>.<REGION>.run.app.
set -eu
: "${PROJECT:?set PROJECT}"
: "${WEB_ORIGIN:?set WEB_ORIGIN}"
REGION=${REGION:-us-central1}
SERVICE=${SERVICE:-observing-exact}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

"$(dirname "$0")/stage.sh" "$stage"
image="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE:$(date +%Y%m%d%H%M%S)"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null
docker build --platform linux/amd64 -t "$image" "$stage"
docker push "$image"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$image" \
  --allow-unauthenticated --cpu 1 --memory 128Mi --min-instances 0 --max-instances 3 --quiet
echo "deployed $SERVICE for $WEB_ORIGIN"
