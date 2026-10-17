# Every production image, built together by `docker buildx bake --push` in
# the build-images CI job. One BuildKit session builds all of them, so the
# Rust toolchain and compiled dependencies (shared by all the Rust images, see
# RUST_PACKAGES in the Dockerfile) are pulled from the registry cache once per
# push rather than once per image. Each image keeps its own :buildcache.
#
# Run it from the repo root, which is the build context. Locally,
# `docker buildx bake -f infra/docker/docker-bake.hcl --print` shows the
# resolved targets, and adding a target name (e.g. tap-ingester) builds just
# that image.

variable "REGISTRY" {
  default = "observing"
}

# Baked into the appview's JS bundle; see the frontend-builder stage.
variable "VITE_MAPTILER_KEY" {
  default = ""
}

group "default" {
  targets = [
    "observing-appview",
    "observing-species-id",
    "observing-species-id-live",
    "observing-migrate",
    "tap-ingester",
    "observing-task-runner",
  ]
}

target "_image" {
  context    = "."
  dockerfile = "infra/docker/Dockerfile"
}

target "observing-appview" {
  inherits   = ["_image"]
  args       = { SERVICE = "observing-appview", VITE_MAPTILER_KEY = VITE_MAPTILER_KEY }
  tags       = ["${REGISTRY}/observing-appview:latest"]
  cache-from = ["type=registry,ref=${REGISTRY}/observing-appview:buildcache"]
  cache-to   = ["type=registry,ref=${REGISTRY}/observing-appview:buildcache,mode=max"]
}

target "observing-species-id" {
  inherits   = ["_image"]
  args       = { SERVICE = "observing-species-id" }
  tags       = ["${REGISTRY}/observing-species-id:latest"]
  cache-from = ["type=registry,ref=${REGISTRY}/observing-species-id:buildcache"]
  cache-to   = ["type=registry,ref=${REGISTRY}/observing-species-id:buildcache,mode=max"]
}

# Same binary as observing-species-id with the faster ViT-L model bundle baked
# in. Serves the live camera loop; see infra/README.md.
target "observing-species-id-live" {
  inherits = ["_image"]
  args = {
    SERVICE           = "observing-species-id"
    SPECIES_MODEL_URL = "https://github.com/observ-ing/bioclip-models/releases/download/vit-l-v1.0.0/bioclip-2-vit-l-models.tar.gz"
    MODEL_VERSION     = "bioclip-2-vit-l-14"
  }
  tags       = ["${REGISTRY}/observing-species-id-live:latest"]
  cache-from = ["type=registry,ref=${REGISTRY}/observing-species-id-live:buildcache"]
  cache-to   = ["type=registry,ref=${REGISTRY}/observing-species-id-live:buildcache,mode=max"]
}

target "observing-migrate" {
  inherits   = ["_image"]
  args       = { SERVICE = "observing-migrate" }
  tags       = ["${REGISTRY}/observing-migrate:latest"]
  cache-from = ["type=registry,ref=${REGISTRY}/observing-migrate:buildcache"]
  cache-to   = ["type=registry,ref=${REGISTRY}/observing-migrate:buildcache,mode=max"]
}

target "tap-ingester" {
  inherits   = ["_image"]
  args       = { SERVICE = "tap-ingester" }
  tags       = ["${REGISTRY}/tap-ingester:latest"]
  cache-from = ["type=registry,ref=${REGISTRY}/tap-ingester:buildcache"]
  cache-to   = ["type=registry,ref=${REGISTRY}/tap-ingester:buildcache,mode=max"]
}

target "observing-task-runner" {
  inherits   = ["_image"]
  args       = { SERVICE = "observing-task-runner" }
  tags       = ["${REGISTRY}/observing-task-runner:latest"]
  cache-from = ["type=registry,ref=${REGISTRY}/observing-task-runner:buildcache"]
  cache-to   = ["type=registry,ref=${REGISTRY}/observing-task-runner:buildcache,mode=max"]
}
