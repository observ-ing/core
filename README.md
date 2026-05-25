# Observ.ing

A decentralized biodiversity observation platform built on the AT Protocol.

## Overview

Observ.ing lets users record and share biodiversity observations on the federated AT Protocol network. Data follows [Darwin Core](https://dwc.tdwg.org/) standards for scientific interoperability.

**Your data, your server** - Observations are stored on your Personal Data Server (PDS), not a central database.

## Quick Start

Prerequisites: Node 24+, Rust (auto-pinned by `rust-toolchain.toml`),
PostgreSQL (14+) with PostGIS,
[`process-compose`](https://github.com/F1bonacc1/process-compose),
ONNX Runtime (`brew install onnxruntime` on macOS), and optionally Go
for building the `tap` binary. Details in
[docs/development.md](docs/development.md#prerequisites).

```bash
cp .env.example .env                  # tweak DATABASE_URL etc. as needed
npm run setup                         # one-time: prereqs, deps, tap, models
# ensure Postgres is running (see docs/development.md#database-setup)
process-compose up -D                 # runs migrations, then starts services
open http://localhost:3000
```

If anything goes wrong, `npm run doctor` walks every prerequisite the
stack needs and prints what's missing.

> Cold setup downloads ~1.4 GB of models and compiles the full Rust
> workspace — budget 20–40 minutes the first time.

## Documentation

- [Development](docs/development.md) — local setup, commands, services
- [Contributing](CONTRIBUTING.md) — PR flow, formatting, CI gates
- [Architecture](docs/architecture.md) — system design and components
- [Deployment](docs/deployment.md) — Cloud Run deployment
- [Darwin Core](docs/darwin-core.md) — lexicon schemas

## License

Licensed under either of

 * Apache License, Version 2.0
   ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
 * MIT license
   ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
