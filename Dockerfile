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
# Supported SERVICE values:
#   observing-appview, observing-ingester, observing-media-proxy, observing-taxonomy

ARG SERVICE=observing-appview

# ---------------------------------------------------------------------------
# Stage: frontend-builder (only meaningful for appview)
# ---------------------------------------------------------------------------
FROM node:24-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/ frontend/
RUN npm run build

# ---------------------------------------------------------------------------
# Stage: deps – cache compiled dependencies
# ---------------------------------------------------------------------------
FROM rust:1.93-slim-bookworm AS deps

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests
COPY Cargo.toml Cargo.lock ./

# Copy all crate manifests (this block must be updated when crates are added)
COPY crates/at-uri-parser/Cargo.toml crates/at-uri-parser/
COPY crates/atproto-blob-resolver/Cargo.toml crates/atproto-blob-resolver/
COPY crates/file-blob-cache/Cargo.toml crates/file-blob-cache/
COPY crates/gbif-api/Cargo.toml crates/gbif-api/
COPY crates/jetstream-client/Cargo.toml crates/jetstream-client/
COPY crates/observing-appview/Cargo.toml crates/observing-appview/
COPY crates/observing-db/Cargo.toml crates/observing-db/
COPY crates/nominatim-client/Cargo.toml crates/nominatim-client/
COPY crates/atproto-identity/Cargo.toml crates/atproto-identity/
COPY crates/observing-ingester/Cargo.toml crates/observing-ingester/
COPY crates/observing-lexicons/Cargo.toml crates/observing-lexicons/
COPY crates/observing-media-proxy/Cargo.toml crates/observing-media-proxy/
COPY crates/observing-taxonomy/Cargo.toml crates/observing-taxonomy/

# Create dummy sources so cargo can resolve the workspace and cache deps
RUN for crate in at-uri-parser atproto-blob-resolver file-blob-cache gbif-api \
        jetstream-client observing-appview observing-db nominatim-client \
        atproto-identity observing-ingester observing-lexicons \
        observing-media-proxy observing-taxonomy; do \
        mkdir -p crates/$crate/src && \
        echo "fn main() {}" > crates/$crate/src/main.rs && \
        echo "" > crates/$crate/src/lib.rs; \
    done

ARG SERVICE
RUN cargo build --release -p ${SERVICE}

# ---------------------------------------------------------------------------
# Stage: builder – compile the real binary
# ---------------------------------------------------------------------------
FROM deps AS builder

# Remove dummy sources
RUN find crates -name "*.rs" -delete

# Copy all real source code and assets
COPY crates/ crates/
COPY .sqlx ./.sqlx

# Rebuild with real sources
ENV SQLX_OFFLINE=true
ARG SERVICE
RUN cargo build --release -p ${SERVICE}

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
# Stage: runtime for media-proxy
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-observing-media-proxy

COPY --from=builder /app/target/release/observing-media-proxy /app/observing-media-proxy

RUN mkdir -p /app/cache/media

ENV RUST_LOG=observing_media_proxy=info
ENV PORT=3001
ENV CACHE_DIR=/app/cache/media
EXPOSE 3001
CMD ["/app/observing-media-proxy"]

# ---------------------------------------------------------------------------
# Stage: runtime for taxonomy
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-observing-taxonomy

COPY --from=builder /app/target/release/observing-taxonomy /app/observing-taxonomy

ENV RUST_LOG=observing_taxonomy=info
ENV PORT=8080
EXPOSE 8080
CMD ["/app/observing-taxonomy"]

# ---------------------------------------------------------------------------
# Final stage: select the correct runtime based on SERVICE arg
# ---------------------------------------------------------------------------
ARG SERVICE
FROM runtime-${SERVICE} AS final
