# Stage 1: Build frontend
FROM node:24-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY frontend/ frontend/

RUN npm run build

# Stage 2: Build Rust binary
FROM rust:1.93-slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests
COPY Cargo.toml Cargo.lock ./

# Copy all crate manifests
COPY crates/at-uri-parser/Cargo.toml crates/at-uri-parser/
COPY crates/atproto-blob-resolver/Cargo.toml crates/atproto-blob-resolver/
COPY crates/file-blob-cache/Cargo.toml crates/file-blob-cache/
COPY crates/gbif-api/Cargo.toml crates/gbif-api/
COPY crates/jetstream-client/Cargo.toml crates/jetstream-client/
COPY crates/observing-appview/Cargo.toml crates/observing-appview/
COPY crates/observing-db/Cargo.toml crates/observing-db/
COPY crates/observing-geocoding/Cargo.toml crates/observing-geocoding/
COPY crates/observing-identity/Cargo.toml crates/observing-identity/
COPY crates/observing-ingester/Cargo.toml crates/observing-ingester/
COPY crates/observing-lexicons/Cargo.toml crates/observing-lexicons/
COPY crates/observing-media-proxy/Cargo.toml crates/observing-media-proxy/
COPY crates/observing-taxonomy/Cargo.toml crates/observing-taxonomy/

# Create dummy sources to cache dependencies
RUN for crate in at-uri-parser atproto-blob-resolver file-blob-cache gbif-api jetstream-client observing-appview observing-db observing-geocoding observing-identity observing-ingester observing-lexicons observing-media-proxy observing-taxonomy; do \
        mkdir -p crates/$crate/src && \
        echo "fn main() {}" > crates/$crate/src/main.rs && \
        echo "" > crates/$crate/src/lib.rs; \
    done

# Build dependencies only (this layer will be cached)
RUN cargo build --release -p observing-appview && \
    rm -rf crates/at-uri-parser/src crates/observing-appview/src crates/observing-db/src crates/observing-identity/src crates/observing-geocoding/src crates/observing-lexicons/src crates/gbif-api/src

# Copy real source code
COPY crates/at-uri-parser/src crates/at-uri-parser/src
COPY crates/observing-appview/src crates/observing-appview/src
COPY crates/observing-db/src crates/observing-db/src
COPY crates/observing-db/migrations crates/observing-db/migrations
COPY crates/observing-identity/src crates/observing-identity/src
COPY crates/observing-geocoding/src crates/observing-geocoding/src
COPY crates/observing-lexicons/src crates/observing-lexicons/src
COPY crates/gbif-api/src crates/gbif-api/src

# Copy SQLx query cache for offline compilation
COPY .sqlx ./.sqlx

# Build for release with offline SQLx
ENV SQLX_OFFLINE=true
RUN touch crates/at-uri-parser/src/lib.rs crates/observing-appview/src/main.rs crates/observing-db/src/lib.rs crates/observing-identity/src/lib.rs crates/observing-geocoding/src/lib.rs crates/observing-lexicons/src/lib.rs crates/gbif-api/src/lib.rs && \
    cargo build --release -p observing-appview

# Stage 3: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary
COPY --from=builder /app/target/release/observing-appview /app/observing-appview

# Copy frontend build output
COPY --from=frontend-builder /app/dist/public /app/public

# Set environment defaults
ENV RUST_LOG=observing_appview=info
ENV PORT=3000
ENV PUBLIC_PATH=/app/public

EXPOSE 3000

CMD ["/app/observing-appview"]
