# pg-url-env

Build a PostgreSQL connection URL from environment variables.

Services on Cloud Run / Cloud SQL commonly accept either a single
`DATABASE_URL` or a bundle of `DB_HOST` / `DB_NAME` / `DB_USER` /
`DB_PASSWORD` / `DB_PORT` (where `DB_HOST` may be a `/cloudsql/...` unix-socket
path). This crate turns those into a connection string, with optional
`search_path` pinning.

```rust,ignore
// DATABASE_URL if set, else assembled from DB_* (None if neither is present):
let url = pg_url_env::database_url_from_env("mydb")
    .unwrap_or_else(|| "postgres://localhost/mydb".to_string());

// DB_* only, pinning a schema search_path:
let url = pg_url_env::postgres_url_from_db_env("mydb", Some("tap"));
```

Zero dependencies; the URL-assembly core is a pure function and unit-tested.
