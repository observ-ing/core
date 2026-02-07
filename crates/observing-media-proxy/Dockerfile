# Build stage
FROM rust:1.93-slim-bookworm as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests
COPY Cargo.toml Cargo.lock ./

# Copy all crate manifests
COPY crates/gbif-api/Cargo.toml crates/gbif-api/
COPY crates/observing-appview/Cargo.toml crates/observing-appview/
COPY crates/observing-db/Cargo.toml crates/observing-db/
COPY crates/observing-geocoding/Cargo.toml crates/observing-geocoding/
COPY crates/observing-identity/Cargo.toml crates/observing-identity/
COPY crates/observing-ingester/Cargo.toml crates/observing-ingester/
COPY crates/observing-lexicons/Cargo.toml crates/observing-lexicons/
COPY crates/observing-media-proxy/Cargo.toml crates/observing-media-proxy/
COPY crates/observing-taxonomy/Cargo.toml crates/observing-taxonomy/

# Create dummy sources to cache dependencies
RUN for crate in gbif-api observing-appview observing-db observing-geocoding observing-identity observing-ingester observing-lexicons observing-media-proxy observing-taxonomy; do \
        mkdir -p crates/$crate/src && \
        echo "fn main() {}" > crates/$crate/src/main.rs && \
        echo "" > crates/$crate/src/lib.rs; \
    done

# Build dependencies only (this layer will be cached)
RUN cargo build --release -p observing-media-proxy && rm -rf crates/observing-media-proxy/src

# Copy real source code for media proxy
COPY crates/observing-media-proxy/src crates/observing-media-proxy/src

# Build for release (touch to invalidate cache for main.rs)
RUN touch crates/observing-media-proxy/src/main.rs && cargo build --release -p observing-media-proxy

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create cache directory
RUN mkdir -p /app/cache/media

# Copy the binary from builder
COPY --from=builder /app/target/release/observing-media-proxy /app/observing-media-proxy

# Set environment defaults
ENV RUST_LOG=observing_media_proxy=info
ENV PORT=3001
ENV CACHE_DIR=/app/cache/media

EXPOSE 3001

CMD ["/app/observing-media-proxy"]
