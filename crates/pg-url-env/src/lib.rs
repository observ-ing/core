//! Build a PostgreSQL connection URL from environment variables.
//!
//! Services deployed on Cloud Run / Cloud SQL commonly accept either a single
//! `DATABASE_URL` or a bundle of `DB_HOST` / `DB_NAME` / `DB_USER` /
//! `DB_PASSWORD` / `DB_PORT` vars (where `DB_HOST` may be a `/cloudsql/...`
//! unix socket path). This crate turns those into a connection string.
//!
//! ```ignore
//! // DATABASE_URL if set, else assembled from DB_* (None if neither is set):
//! let url = pg_url_env::database_url_from_env("mydb")
//!     .unwrap_or_else(|| "postgres://localhost/mydb".to_string());
//!
//! // Assemble from DB_* only, pinning a schema search_path:
//! let url = pg_url_env::postgres_url_from_db_env("mydb", Some("tap"));
//! ```

/// Build a connection URL from already-resolved parts.
///
/// A `/cloudsql/...` `host` is treated as a unix-socket directory (passed via
/// the `?host=` query param against `localhost`); anything else is a TCP host.
/// When `search_path` is `Some`, an `options=-c search_path=<sp>` parameter is
/// appended (URL-encoded).
fn build_url(
    host: &str,
    name: &str,
    user: &str,
    password: &str,
    port: &str,
    search_path: Option<&str>,
) -> String {
    let mut url = if host.starts_with("/cloudsql/") {
        format!("postgresql://{user}:{password}@localhost/{name}?host={host}")
    } else {
        format!("postgresql://{user}:{password}@{host}:{port}/{name}")
    };

    if let Some(sp) = search_path {
        let sep = if url.contains('?') { '&' } else { '?' };
        url.push(sep);
        // `-c search_path=<sp>`, percent-encoded (space -> %20, '=' -> %3D).
        url.push_str("options=-c%20search_path%3D");
        url.push_str(sp);
    }

    url
}

/// Assemble a Postgres URL from the `DB_HOST` / `DB_NAME` / `DB_USER` /
/// `DB_PASSWORD` / `DB_PORT` environment variables.
///
/// Returns `None` if `DB_HOST` is unset. `DB_NAME` defaults to
/// `default_db_name`, `DB_USER` to `postgres`, `DB_PASSWORD` to empty, and
/// `DB_PORT` to `5432` (ignored for Cloud SQL sockets). See [`build_url`] for
/// the `search_path` behavior.
pub fn postgres_url_from_db_env(
    default_db_name: &str,
    search_path: Option<&str>,
) -> Option<String> {
    let host = std::env::var("DB_HOST").ok()?;
    let name = std::env::var("DB_NAME").unwrap_or_else(|_| default_db_name.to_string());
    let user = std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string());
    let password = std::env::var("DB_PASSWORD").unwrap_or_default();
    let port = std::env::var("DB_PORT").unwrap_or_else(|_| "5432".to_string());
    Some(build_url(
        &host,
        &name,
        &user,
        &password,
        &port,
        search_path,
    ))
}

/// `DATABASE_URL` if set, otherwise [`postgres_url_from_db_env`] with no
/// `search_path`. `None` if neither `DATABASE_URL` nor `DB_HOST` is present —
/// the caller decides the fallback (a default URL, or an error).
pub fn database_url_from_env(default_db_name: &str) -> Option<String> {
    if let Ok(url) = std::env::var("DATABASE_URL") {
        return Some(url);
    }
    postgres_url_from_db_env(default_db_name, None)
}

#[cfg(test)]
mod tests {
    use super::build_url;

    #[test]
    fn tcp_without_search_path() {
        assert_eq!(
            build_url("db.example.com", "mydb", "alice", "secret", "5432", None),
            "postgresql://alice:secret@db.example.com:5432/mydb"
        );
    }

    #[test]
    fn tcp_with_search_path() {
        assert_eq!(
            build_url(
                "db.example.com",
                "mydb",
                "alice",
                "secret",
                "6543",
                Some("tap")
            ),
            "postgresql://alice:secret@db.example.com:6543/mydb?options=-c%20search_path%3Dtap"
        );
    }

    #[test]
    fn cloudsql_socket_without_search_path() {
        assert_eq!(
            build_url(
                "/cloudsql/proj:region:inst",
                "mydb",
                "alice",
                "secret",
                "5432",
                None
            ),
            "postgresql://alice:secret@localhost/mydb?host=/cloudsql/proj:region:inst"
        );
    }

    #[test]
    fn cloudsql_socket_with_search_path() {
        // The socket form already carries `?host=`, so search_path is joined
        // with `&`.
        assert_eq!(
            build_url(
                "/cloudsql/proj:region:inst",
                "mydb",
                "alice",
                "secret",
                "5432",
                Some("tap")
            ),
            "postgresql://alice:secret@localhost/mydb?host=/cloudsql/proj:region:inst&options=-c%20search_path%3Dtap"
        );
    }
}
