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

# Copy crate manifests
COPY crates/gbif-api/Cargo.toml crates/gbif-api/
COPY crates/observing-ingester/Cargo.toml crates/observing-ingester/
COPY crates/observing-media-proxy/Cargo.toml crates/observing-media-proxy/
COPY crates/observing-taxonomy/Cargo.toml crates/observing-taxonomy/

# Create dummy sources to cache dependencies
RUN mkdir -p crates/gbif-api/src crates/observing-ingester/src crates/observing-media-proxy/src crates/observing-taxonomy/src && \
    echo "" > crates/gbif-api/src/lib.rs && \
    echo "fn main() {}" > crates/observing-ingester/src/main.rs && \
    echo "" > crates/observing-ingester/src/lib.rs && \
    echo "fn main() {}" > crates/observing-media-proxy/src/main.rs && \
    echo "" > crates/observing-media-proxy/src/lib.rs && \
    echo "fn main() {}" > crates/observing-taxonomy/src/main.rs

# Build dependencies only (this layer will be cached)
RUN cargo build --release -p observing-taxonomy && rm -rf crates/observing-taxonomy/src

# Copy real source code for taxonomy
COPY crates/gbif-api/src crates/gbif-api/src
COPY crates/observing-taxonomy/src crates/observing-taxonomy/src

# Build for release (touch to invalidate cache for changed sources)
RUN touch crates/gbif-api/src/lib.rs crates/observing-taxonomy/src/main.rs && cargo build --release -p observing-taxonomy

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
