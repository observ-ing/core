# atproto-oauth-pg-store

PostgreSQL-backed `StateStore` and `SessionStore` implementations for the
[`atrium-oauth`](https://docs.rs/atrium-oauth) AT Protocol OAuth client.

`atrium-oauth` ships only in-memory stores, so OAuth state and sessions are
lost on restart and cannot be shared across replicas. This crate persists both
to Postgres via [`sqlx`].

## Usage

```rust,ignore
use atproto_oauth_pg_store::{PgSessionStore, PgStateStore};

let state_store = PgStateStore::new(pool.clone());
let session_store = PgSessionStore::new(pool);

let client = atrium_oauth::OAuthClient::new(atrium_oauth::OAuthClientConfig {
    // ...other config...
    state_store,
    session_store,
})?;
```

The state TTL defaults to [`DEFAULT_STATE_TTL_MS`] (10 minutes); use
`PgStateStore::with_ttl_ms` to override it.

The low-level `get_state` / `set_state` / `get_session` / ... functions are also
public, so you can read a stored session directly (e.g. to gate an endpoint on
session presence) without going through the `Store` trait.

## Schema

Two tables are required; the DDL is in [`migrations/0001_oauth_tables.sql`](migrations/0001_oauth_tables.sql).
Point `sqlx migrate` at this crate's `migrations/` directory, or copy the
statements into your own migrations. Queries use runtime `sqlx::query`, so the
crate compiles without a live database or a vendored `.sqlx` cache.

[`sqlx`]: https://docs.rs/sqlx
