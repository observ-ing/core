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
# Stage: runtime for species-id
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-observing-species-id

# Install ONNX Runtime shared library
RUN apt-get update && apt-get install -y wget && \
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v1.21.1/onnxruntime-linux-x64-1.21.1.tgz && \
    tar xzf onnxruntime-linux-x64-1.21.1.tgz && \
    cp onnxruntime-linux-x64-1.21.1/lib/* /usr/lib/ && \
    rm -rf onnxruntime-* && \
    apt-get remove -y wget && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/observing-species-id /app/observing-species-id

ENV RUST_LOG=observing_species_id=info
ENV PORT=3005
ENV MODEL_DIR=/app/models/bioclip
ENV ORT_DYLIB_PATH=/usr/lib/libonnxruntime.so
EXPOSE 3005
CMD ["/app/observing-species-id"]

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
