# Contributing

Thanks for considering a contribution! This guide covers the practical
bits: how to get a working dev environment, what CI will check, and what
we expect in PRs.

For setup, start at [docs/development.md](docs/development.md).

## Quick start

```bash
git clone <repo>
cd core
cp .env.example .env                  # tweak DATABASE_URL etc. as needed
npm run setup                         # one-time: prereqs, deps, tap, models
# ensure Postgres is running (see docs/development.md#database-setup)
process-compose up -D                 # runs migrations, then starts services
open http://localhost:3000
```

`npm run doctor` walks every prerequisite the stack needs and prints
what's missing — run it any time things look broken.

Prerequisites (Node 24+, Rust per `rust-toolchain.toml`, Postgres+PostGIS,
process-compose, ONNX Runtime, optional Go for `tap`) are listed in
[docs/development.md](docs/development.md#prerequisites). On macOS,
`brew bundle` installs all of them from the project's `Brewfile`.

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

Lexicons are authored in [MLF](https://mlf.lol) ("Matt's Lexicon
Format"), a human-friendly DSL for ATProto lexicons. The `.mlf` files in
`lexicons-src/` are the **source of truth**; everything downstream is
generated:

```
lexicons-src/**/*.mlf   →  lexicons/**/*.json  →  crates/observing-lexicons/src/**
        (edit these)        (generated JSON)         (generated Rust types)
```

Edit the `.mlf` files, then regenerate both the JSON and the Rust types
in one step:

```bash
npm run generate-lexicons      # mlf check → JSON → jacquard-codegen Rust
cargo fmt -p observing-lexicons
```

The script installs the pinned `mlf` CLI on first run. Commit the
regenerated `lexicons/` **and** `crates/observing-lexicons/src/`
alongside your `lexicons-src/` edits — CI's `rust-lexicons-check` job
regenerates from the `.mlf` sources and fails on any drift.

> Do not hand-edit `lexicons/*.json` — those files are generated and
> your changes will be overwritten on the next regeneration.

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
