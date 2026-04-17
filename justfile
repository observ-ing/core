_default:
    @just --list

# --- process-compose ---

# Start all services (detached)
up:
    process-compose up -D

# Stop all services
down:
    process-compose down

# List running processes
ps:
    process-compose process list

# Tail logs for a service (cloud-sql-proxy, appview, frontend, ingester, species-id)
logs service:
    process-compose process logs {{service}}

# Restart a service
restart service:
    process-compose process restart {{service}}

# Rebuild static frontend and restart appview to serve it
rebuild-appview:
    npm run build
    process-compose process restart appview

# --- build / codegen ---

# Build Rust workspace
build-rust:
    cargo build

# Build static frontend
build-frontend:
    npm run build

# Generate lexicon types (Rust + TypeScript)
gen:
    npm run generate-rust-types
    npm run generate-types

# --- format / lint ---

# Format Rust + TypeScript
fmt:
    cargo fmt
    npm run fmt

# Check formatting + lint without modifying files (CI-equivalent)
check:
    cargo fmt --check
    cargo clippy --workspace --all-targets -- -D warnings
    npm run fmt:check
    npm run lint

# --- tests ---

# Rust workspace tests
test:
    cargo test --workspace

# Frontend integration tests (requires stack running)
test-integration:
    npm run test:integration

# Frontend e2e tests (requires stack running + .env creds)
test-e2e:
    npm run test:e2e

# --- scripts ---

# Download BioCLIP models for species-id
download-models:
    ./scripts/download-models.sh
