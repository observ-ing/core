# Build stage
FROM rust:1.92-slim-bookworm as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests
COPY Cargo.toml Cargo.lock ./

# Copy package manifests
COPY packages/biosky-ingester/Cargo.toml packages/biosky-ingester/
COPY packages/biosky-media-proxy-rs/Cargo.toml packages/biosky-media-proxy-rs/

# Create dummy sources to cache dependencies
RUN mkdir -p packages/biosky-ingester/src packages/biosky-media-proxy-rs/src && \
    echo "fn main() {}" > packages/biosky-ingester/src/main.rs && \
    echo "" > packages/biosky-ingester/src/lib.rs && \
    echo "fn main() {}" > packages/biosky-media-proxy-rs/src/main.rs && \
    echo "" > packages/biosky-media-proxy-rs/src/lib.rs

# Build dependencies only (this layer will be cached)
RUN cargo build --release -p biosky-media-proxy && rm -rf packages/biosky-media-proxy-rs/src

# Copy real source code for media proxy
COPY packages/biosky-media-proxy-rs/src packages/biosky-media-proxy-rs/src

# Build for release (touch to invalidate cache for main.rs)
RUN touch packages/biosky-media-proxy-rs/src/main.rs && cargo build --release -p biosky-media-proxy

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
COPY --from=builder /app/target/release/biosky-media-proxy /app/biosky-media-proxy

# Set environment defaults
ENV RUST_LOG=biosky_media_proxy=info
ENV PORT=3001
ENV CACHE_DIR=/app/cache/media

EXPOSE 3001

CMD ["/app/biosky-media-proxy"]
