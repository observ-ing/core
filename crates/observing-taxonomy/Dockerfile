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
COPY packages/observing-taxonomy/Cargo.toml packages/observing-taxonomy/

# Create dummy sources to cache dependencies
RUN mkdir -p packages/observing-ingester/src packages/observing-media-proxy/src packages/observing-taxonomy/src && \
    echo "fn main() {}" > packages/observing-ingester/src/main.rs && \
    echo "" > packages/observing-ingester/src/lib.rs && \
    echo "fn main() {}" > packages/observing-media-proxy/src/main.rs && \
    echo "" > packages/observing-media-proxy/src/lib.rs && \
    echo "fn main() {}" > packages/observing-taxonomy/src/main.rs

# Build dependencies only (this layer will be cached)
RUN cargo build --release -p observing-taxonomy && rm -rf packages/observing-taxonomy/src

# Copy real source code for taxonomy
COPY packages/observing-taxonomy/src packages/observing-taxonomy/src

# Build for release (touch to invalidate cache for main.rs)
RUN touch packages/observing-taxonomy/src/main.rs && cargo build --release -p observing-taxonomy

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/target/release/observing-taxonomy /app/observing-taxonomy

# Set environment defaults
ENV RUST_LOG=observing_taxonomy=info
ENV PORT=8080

EXPOSE 8080

CMD ["/app/observing-taxonomy"]
