//! Demo server. Connects to the throwaway `admindemo` Postgres container and
//! serves the admin at <http://127.0.0.1:3030/admin/>.
//!
//! Run with: `cargo run -p axum-admin --example serve`

use axum::Router;
use axum_admin::postgres::PgTable;
use axum_admin::Admin;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:demo@localhost:55432/admindemo".to_string());
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await?;

    // Each table is a plugin. `PgTable` is the Postgres/sqlx implementation;
    // register your own `TableSource` here too.
    let admin = Admin::new()
        .table(PgTable::new(pool.clone(), "public", "posts").searchable(["title", "body"]))
        .table(PgTable::new(pool.clone(), "public", "users").display_name("Users"));

    let app = Router::new().nest("/admin", admin.into_router("/admin"));

    let addr = "127.0.0.1:3030";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("axum-admin demo: http://{addr}/admin/");
    axum::serve(listener, app).await?;
    Ok(())
}
