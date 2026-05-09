# Multi-service Dockerfile
#
# Build any service:
#   docker build --build-arg SERVICE=observing-ingester -t observing-ingester .
#   docker build --build-arg SERVICE=observing-appview -t observing-appview .
#
# For appview (which includes a frontend), the frontend stage runs
# automatically but its output is only copied into the final image
# when SERVICE=observing-appview.
#
# For tap-ingester, the `tap` binary from bluesky-social/indigo is built
# in a Go stage and bundled into the runtime image; tapped::TapProcess
# spawns it as a child process at runtime.
#
# Supported SERVICE values:
#   observing-appview, observing-ingester, observing-species-id, observing-migrate, tap-ingester

ARG SERVICE=observing-appview

# ---------------------------------------------------------------------------
# Stage: frontend-builder (only meaningful for appview)
# ---------------------------------------------------------------------------
FROM node:24-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/ frontend/
COPY lexicons/ lexicons/
RUN npm run build

# ---------------------------------------------------------------------------
# Stage: chef – install cargo-chef
# ---------------------------------------------------------------------------
FROM rust:1.93-slim-bookworm AS chef

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN cargo install cargo-chef

WORKDIR /app

# ---------------------------------------------------------------------------
# Stage: planner – analyze dependencies and produce a recipe
# ---------------------------------------------------------------------------
FROM chef AS planner

COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/

RUN cargo chef prepare --recipe-path recipe.json

# ---------------------------------------------------------------------------
# Stage: deps – cook (compile) only the dependencies from the recipe
# ---------------------------------------------------------------------------
FROM chef AS deps

COPY --from=planner /app/recipe.json recipe.json

ARG SERVICE
RUN cargo chef cook --release --recipe-path recipe.json -p ${SERVICE}

# ---------------------------------------------------------------------------
# Stage: builder – compile the real binary
# ---------------------------------------------------------------------------
FROM deps AS builder

# Copy all source code and assets
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY .sqlx ./.sqlx

ENV SQLX_OFFLINE=true
ARG SERVICE
RUN cargo build --release -p ${SERVICE}

# ---------------------------------------------------------------------------
# Stage: tap-build – build the upstream `tap` Go binary (only used by
# the tap-ingester runtime, but Docker BuildKit prunes unused stages so
# this is free for other services).
# ---------------------------------------------------------------------------
FROM golang:1.26-bookworm AS tap-build

# Pinned to indigo main as of 2026-04-28. Bump deliberately when upstream
# tap or its event format changes.
ARG INDIGO_REV=ce62b8fce9e01434213a69cb251852b2c9436cb9

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git init . \
    && git remote add origin https://github.com/bluesky-social/indigo.git \
    && git fetch --depth 1 origin ${INDIGO_REV} \
    && git checkout FETCH_HEAD

ENV GODEBUG=netdns=go
RUN go build -tags timetzdata -o /tap ./cmd/tap

# ---------------------------------------------------------------------------
# Stage: runtime-base – shared runtime setup
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime-base

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------------------------------------------------------------------------
# Stage: runtime for appview (includes frontend assets)
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-observing-appview

COPY --from=builder /app/target/release/observing-appview /app/observing-appview
COPY --from=frontend-builder /app/dist/public /app/public

ENV RUST_LOG=observing_appview=info
ENV PORT=3000
ENV PUBLIC_PATH=/app/public
EXPOSE 3000
CMD ["/app/observing-appview"]

# ---------------------------------------------------------------------------
# Stage: runtime for ingester
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-observing-ingester

COPY --from=builder /app/target/release/observing-ingester /app/observing-ingester

ENV RUST_LOG=observing_ingester=info
ENV PORT=8080
EXPOSE 8080
CMD ["/app/observing-ingester"]

# ---------------------------------------------------------------------------
# Stage: runtime for tap-ingester
# Bundles the upstream `tap` binary so tapped::TapProcess can spawn it
# as a child process. The /data directory holds the SQLite cursor/state
# database; on Cloud Run it lives on the ephemeral instance filesystem.
# Losing it on instance restart is fine — Tap re-discovers and re-backfills.
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-tap-ingester

COPY --from=builder /app/target/release/tap-ingester /app/tap-ingester
COPY --from=tap-build /tap /usr/local/bin/tap

RUN mkdir -p /data
ENV RUST_LOG=tap_ingester=info
ENV PORT=8080
EXPOSE 8080
CMD ["/app/tap-ingester"]

# ---------------------------------------------------------------------------
# Stage: runtime for migrate (one-shot Cloud Run Job)
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-observing-migrate

COPY --from=builder /app/target/release/observing-migrate /app/observing-migrate

ENV RUST_LOG=observing_migrate=info,sqlx::migrate=info
CMD ["/app/observing-migrate"]

# ---------------------------------------------------------------------------
# Stage: runtime for species-id
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-observing-species-id

# Install ONNX Runtime shared library
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 10 -o /tmp/ort.tgz \
      https://github.com/microsoft/onnxruntime/releases/download/v1.24.4/onnxruntime-linux-x64-1.24.4.tgz && \
    tar xzf /tmp/ort.tgz && \
    cp onnxruntime-linux-x64-1.24.4/lib/libonnxruntime*.so* /usr/lib/ && \
    rm -rf onnxruntime-* /tmp/ort.tgz

# Download model artifacts (separate layer for better caching)
RUN mkdir -p /app/models/bioclip && \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 10 -o /tmp/models.tar.gz \
      https://github.com/observ-ing/bioclip-models/releases/download/v2.1.0/bioclip-2.5-models.tar.gz && \
    tar xzf /tmp/models.tar.gz -C /app/models/bioclip && \
    rm /tmp/models.tar.gz

# Clean up
RUN apt-get remove -y curl && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/observing-species-id /app/observing-species-id

ENV RUST_LOG=observing_species_id=info
ENV PORT=3005
ENV MODEL_DIR=/app/models/bioclip
ENV ORT_DYLIB_PATH=/usr/lib/libonnxruntime.so
EXPOSE 3005
CMD ["/app/observing-species-id"]

# ---------------------------------------------------------------------------
# Final stage: select the correct runtime based on SERVICE arg
# ---------------------------------------------------------------------------
ARG SERVICE
FROM runtime-${SERVICE} AS final
