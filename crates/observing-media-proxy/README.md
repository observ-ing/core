# Observ.ing Media Proxy (Rust)

High-performance media caching proxy for Observ.ing, written in Rust.

## Overview

This service proxies and caches image blobs from various AT Protocol PDS servers for performant frontend loading. It provides:

- **Blob caching**: Fetches and caches blobs from PDS servers with configurable TTL
- **DID resolution**: Resolves `did:plc:` and `did:web:` DIDs to their PDS endpoints
- **LRU eviction**: Automatically evicts oldest cache entries when the cache is full

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check with cache statistics |
| `GET /blob/:did/:cid` | Fetch and cache a blob |
| `GET /thumb/:did/:cid` | Fetch a thumbnail (currently returns full blob) |

## Response Headers

- `Content-Type`: MIME type of the blob
- `Cache-Control: public, max-age=86400`: Client-side caching for 1 day
- `X-Cache: HIT` or `X-Cache: MISS`: Indicates cache status

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `CACHE_DIR` | `./cache/media` | Directory for cached blobs |
| `MAX_CACHE_SIZE` | `1073741824` (1GB) | Maximum cache size in bytes |
| `CACHE_TTL_SECS` | `86400` (24h) | Cache TTL in seconds |
| `RUST_LOG` | `observing_media_proxy=info` | Log level |
| `LOG_FORMAT` | - | Set to `json` for GCP Cloud Logging |

## Development

```bash
# Run locally
cargo run -p observing-media-proxy

# Run tests
cargo test -p observing-media-proxy

# Build for release
cargo build --release -p observing-media-proxy
```

## Docker

```bash
# Build from repository root
docker build -f crates/observing-media-proxy/Dockerfile -t observing-media-proxy .

# Run
docker run -p 3001:3001 observing-media-proxy
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Media Proxy                               │
├─────────────────────────────────────────────────────────────┤
│  server.rs   │  Axum HTTP routes                            │
│  cache.rs    │  In-memory metadata + file-based storage     │
│  proxy.rs    │  DID resolution + PDS blob fetching          │
│  types.rs    │  Data structures                             │
│  error.rs    │  Custom error types                          │
└─────────────────────────────────────────────────────────────┘
```
