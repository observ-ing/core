# Observ.ing - Claude Code Context

Decentralized biodiversity observation platform built on AT Protocol.

## Documentation

See `docs/` for detailed documentation:
- `docs/architecture.md` - System design and components
- `docs/development.md` - Local setup and commands
- `docs/deployment.md` - Cloud Run deployment
- `/api/docs` - Interactive REST API documentation (when running locally)
- `docs/darwin-core.md` - Lexicon schemas

## Quick Reference

```
crates/
├── observing-appview/     # Unified REST API + OAuth + static serving (Rust/Axum)
├── observing-db/          # Shared database layer (Rust)
├── observing-geocoding/   # Nominatim reverse geocoding (Rust)
├── observing-identity/    # DID/handle resolution + profile caching (Rust)
├── observing-ingester/    # AT Protocol firehose (Rust)
├── observing-media-proxy/ # Image proxy (Rust)
├── observing-taxonomy/    # Taxonomy resolver (Rust)
└── gbif-api/              # GBIF API client (Rust)

packages/
├── observing-frontend/    # Web UI (Vite + React)
└── observing-lexicon/     # AT Protocol lexicon types
```

## After Code Changes

Always run after making changes:
```bash
npx tsc              # Typecheck frontend/lexicon
cargo build          # Build Rust workspace
cargo test           # Run Rust tests
```

## Local Development

Use process-compose to manage services:
```bash
process-compose up -D           # Start all services
process-compose process list    # View status
process-compose down            # Stop all
```

**Important:** The app runs at `http://localhost:3000` (not 5173). Port 3000 serves built files from `dist/public`.

After frontend changes, rebuild and restart:
```bash
npm run frontend:build && process-compose process restart appview
```

## Visual Testing

Use Playwright MCP tools to browse `http://localhost:3000`. Always use port 3000 for testing (OAuth only works there).
