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
COPY packages/observing-ingester/Cargo.toml packages/observing-ingester/
COPY packages/observing-media-proxy/Cargo.toml packages/observing-media-proxy/

# Create dummy sources to cache dependencies
RUN mkdir -p packages/observing-ingester/src packages/observing-media-proxy/src && \
    echo "fn main() {}" > packages/observing-ingester/src/main.rs && \
    echo "" > packages/observing-ingester/src/lib.rs && \
    echo "fn main() {}" > packages/observing-media-proxy/src/main.rs && \
    echo "" > packages/observing-media-proxy/src/lib.rs

# Build dependencies only (this layer will be cached)
RUN cargo build --release -p observing-media-proxy && rm -rf packages/observing-media-proxy/src

# Copy real source code for media proxy
COPY packages/observing-media-proxy/src packages/observing-media-proxy/src

# Build for release (touch to invalidate cache for main.rs)
RUN touch packages/observing-media-proxy/src/main.rs && cargo build --release -p observing-media-proxy

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
