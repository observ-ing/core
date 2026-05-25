# Troubleshooting

Common failures during local development, and what to do about them.
If you hit something not listed here, please add it — the next person
will thank you.

## Postgres / database

### `connection refused` on `localhost:5432`

Postgres isn't running. If you used the Docker recipe from
[development.md](./development.md#database-setup):

```bash
docker start observing-postgres
```

If you installed natively, start it however that install starts (e.g.
`brew services start postgresql@16`).

### `extension "postgis" is not available` during migrations

You have Postgres, but not the PostGIS extension. Easiest fix is to
recreate the container with the PostGIS image:

```bash
docker rm -f observing-postgres
docker run --name observing-postgres \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -p 5432:5432 \
  -d postgis/postgis
docker exec -it observing-postgres createdb -U postgres observing
```

For native installs, add the PostGIS package (`postgresql-contrib` +
`postgis` on Debian, `postgis` on Homebrew) and `CREATE EXTENSION
postgis;` in the `observing` database.

### `password authentication failed for user "postgres"`

The password in `DATABASE_URL` doesn't match what the container was
created with. Either recreate the container with the password from your
`.env`, or update `DATABASE_URL` to match the existing container.

### Migrations seem to have run, but the schema is wrong

Check what's actually applied:

```bash
cargo sqlx migrate info --source crates/observing-db/migrations
```

If state is wedged from prior experimentation, the fastest reset is
dropping and recreating the database:

```bash
docker exec -it observing-postgres dropdb -U postgres observing
docker exec -it observing-postgres createdb -U postgres observing
cargo run -p observing-migrate
```

## species-id / ONNX

### `cannot open shared object file: libonnxruntime`

`ORT_DYLIB_PATH` points at a file that doesn't exist. Install ONNX
Runtime and update the path in `.env`:

- macOS: `brew install onnxruntime` (drops it under `/opt/homebrew/lib`
  on Apple Silicon, `/usr/local/lib` on Intel)
- Linux: install `libonnxruntime` / `onnxruntime-dev` from your distro

### `No such file or directory: ./models/bioclip/…`

You haven't downloaded the BioCLIP models yet:

```bash
./scripts/download-models.sh
```

The `models/` directory is gitignored; you'll need to do this once per
checkout.

## tap-ingester

### `failed to spawn child process: No such file or directory (os error 2)`

The `tap` Go binary isn't on `PATH`. Install it per
[Tap binary](./development.md#tap-binary):

```bash
INDIGO_REV=ce62b8fce9e01434213a69cb251852b2c9436cb9
GODEBUG=netdns=go go install \
  github.com/bluesky-social/indigo/cmd/tap@$INDIGO_REV
```

Then verify `which tap` resolves before retrying. If `go install`
succeeded but `tap` isn't found, add `$(go env GOPATH)/bin` to `PATH`.

### tap-ingester starts but `/health` never returns `connected: true`

First boot does a sqlite migration and subscribes to the relay; give it
~30s on a cold start. If it stays disconnected, set `TAP_INHERIT_STDIO=1`
to forward Tap's logs to the terminal (or run inside `process-compose
process logs tap-ingester`), and look for relay/connection errors.

## Frontend

### Edits to a `.tsx` file don't show up at http://localhost:3000

You're in static-build mode. See
[Frontend: dev mode vs static build](./development.md#frontend-dev-mode-vs-static-build).
Quick fix:

```bash
rm -rf dist/public && process-compose process restart appview
```

### `EADDRINUSE: address already in use :::5173` (or `:3000`, `:3005`, `:8080`)

Another process is holding the port. Find and kill it:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
kill <pid>
```

Most often this is a stale process from a previous `process-compose` run
that didn't shut down cleanly. `process-compose down` should clean up;
if it doesn't, `pkill -f "cargo run -p observing-appview"` etc.

## Toolchain

### `error: linking with cc failed` / Rust build fails with cryptic linker errors

Your Rust toolchain is out of sync with `rust-toolchain.toml`. Let
`rustup` pick up the pinned channel:

```bash
rustup show       # confirms the active toolchain
rustup update     # if you're behind
```

### `npm install` errors about `EBADENGINE` / Node version

You're on Node < 24. `package.json` enforces `>=24.0.0`. Use `nvm`,
`fnm`, `mise`, etc. to switch:

```bash
nvm use 24    # or: fnm use 24
```

### `cargo sqlx prepare` / `--check` fails

Either a query changed without `cargo sqlx prepare --workspace` being
re-run, or your local `sqlx-cli` is the wrong version. Pin to match CI:

```bash
cargo install sqlx-cli@0.8.6 --no-default-features --features postgres
```

## E2E tests

### `BLUESKY_TEST_EMAIL, BLUESKY_TEST_PASSWORD, and BLUESKY_TEST_HANDLE env vars are required`

The credentials aren't in your shell. Source `.env` before running:

```bash
set -a && source .env && set +a
npm run test:e2e
```

If `.env` doesn't have those keys, copy them in from `.env.example` and
fill in a throwaway Bluesky account (don't use your personal one).

### Tests time out at "waiting for redirect from Bluesky"

Bluesky's auth flow rejected the login (wrong password, captcha, rate
limit). Sign in manually at https://bsky.app with the test account to
confirm it still works.
