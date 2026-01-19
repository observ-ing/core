# Build stage
FROM rust:1.85-slim-bookworm as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests
COPY Cargo.toml Cargo.lock* ./

# Create dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && echo "" > src/lib.rs

# Build dependencies only (this layer will be cached)
RUN cargo build --release && rm -rf src

# Copy real source code
COPY src ./src

# Build for release (touch to invalidate cache for main.rs)
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/target/release/biosky-ingester /app/biosky-ingester

# Set environment defaults
ENV RUST_LOG=biosky_ingester=info
ENV PORT=8080

EXPOSE 8080

CMD ["/app/biosky-ingester"]
