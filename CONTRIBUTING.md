# Contributing

Thanks for considering a contribution! This guide covers the practical
bits: how to get a working dev environment, what CI will check, and what
we expect in PRs.

For setup, start at [docs/development.md](docs/development.md).

## Quick start

```bash
git clone <repo>
cd core
cp .env.example .env                  # then edit as needed
npm install
./scripts/download-models.sh          # species-id models (~1.4 GB, one-time)
cargo run -p observing-migrate        # apply DB migrations
process-compose up -D                 # start the stack
open http://localhost:3000
```

Prerequisites (Node 24+, Rust per `rust-toolchain.toml`, Postgres+PostGIS,
process-compose, ONNX Runtime, optional Go for `tap`) are listed in
[docs/development.md](docs/development.md#prerequisites).

## Branching and PRs

- Branch off `main` with a short topic name. Conventional prefixes are
  fine (`feat/foo`, `fix/bar`, `refactor/baz`) but not required.
- Open PRs against `main`. Squash-merge is the default; the squash
  commit message should follow the conventional-commits style below.
- Keep PRs focused. If you find unrelated cleanup along the way, split
  it into its own PR — it makes review (and revert, if needed) easier.
- Reference the issue or PR your change extends in the description, not
  the commit message — the description is durable, the commit message
  rots when files move.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/)
with an optional scope. Look at `git log --oneline` for live examples;
the shape is:

```
<type>(<scope>): <imperative summary>
```

Common types: `feat`, `fix`, `refactor`, `perf`, `chore`, `ci`, `docs`,
`test`. Scope is usually a crate or feature area (`tap-ingester`,
`identification`, `explore`, etc.). Examples from history:

```
feat(quality): wire quality filter into explore feed UI
fix(identification): break Community ID label onto its own line
ci(tap-ingester): inherit upstream Tap's stdio for observability
refactor(quality): rename Verifiable filter to Complete
```

## Formatting and linting

CI rejects unformatted or unlinted code. Before pushing:

```bash
# Frontend
npm run fmt          # oxfmt — NOT Prettier
npm run lint         # oxlint
npx tsc              # typecheck

# Rust
cargo fmt --all
cargo clippy --workspace -- -D warnings
```

> Note: this project uses `oxfmt`, not Prettier. Running Prettier will
> produce a different style that CI will reject.

## Tests

```bash
cargo test --workspace          # backend; no setup required
npm run test:integration        # frontend integration (full stack must be up)
npm run test:e2e                # real Bluesky auth — needs credentials in .env
```

The integration and e2e tests both expect `process-compose up -D` to
have been run first. See
[docs/development.md#tests](docs/development.md#tests) for details.

## SQL changes

- Migrations live in `crates/observing-db/migrations/`. Add a new file
  with the next sequential `YYYYMMDDHHMMSS_description.sql` prefix —
  never edit a migration that has shipped.
- After changing any SQL the workspace queries, regenerate the offline
  metadata so the `rust-sqlx` CI job passes:

  ```bash
  cargo sqlx prepare --workspace
  ```

- Commit the resulting `.sqlx/` changes in the same PR.

## Lexicon changes

Lexicon types are codegen'd from `lexicons/`. If you edit them:

```bash
npm run generate-rust-types
cargo fmt -p observing-lexicons
```

Commit the regenerated `crates/observing-lexicons/src/` alongside your
lexicon edits — CI's `rust-lexicons-check` job will fail otherwise.

## What CI runs

For visibility, the full gate is in `.github/workflows/ci.yml`. The
short version:

- **Frontend**: `npm audit`, `oxfmt --check`, `oxlint`, `tsc`,
  `npm run build`, Android APK build, Storybook coverage + build, TS
  bindings drift check
- **Rust**: `cargo check --locked`, `cargo fmt --check`,
  `cargo-deny`, `cargo clippy -D warnings`, `cargo sqlx prepare --check`,
  generated-lexicons drift check, `cargo test --workspace`
- **End-to-end**: full stack (Postgres + appview + tap-ingester +
  built `tap` binary) + Playwright

All of these must pass before merge.

## License

By contributing you agree your work is dual-licensed under MIT and
Apache-2.0 (see [LICENSE-MIT](LICENSE-MIT) and
[LICENSE-APACHE](LICENSE-APACHE)).
