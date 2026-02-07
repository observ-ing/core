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
RUN cargo build --release -p observing-ingester && \
    rm -rf crates/observing-ingester/src crates/observing-db/src crates/observing-lexicons/src

# Copy SQLx query cache for offline compilation
COPY .sqlx ./.sqlx

# Copy real source code
COPY crates/observing-ingester/src crates/observing-ingester/src
COPY crates/observing-db/src crates/observing-db/src
COPY crates/observing-lexicons/src crates/observing-lexicons/src

# Build for release with offline SQLx
ENV SQLX_OFFLINE=true
RUN touch crates/observing-ingester/src/main.rs crates/observing-db/src/lib.rs crates/observing-lexicons/src/lib.rs && \
    cargo build --release -p observing-ingester

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/target/release/observing-ingester /app/observing-ingester

# Set environment defaults
ENV RUST_LOG=observing_ingester=info
ENV PORT=8080

EXPOSE 8080

CMD ["/app/observing-ingester"]
