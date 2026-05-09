//! Demo server. Connects to the throwaway `admindemo` Postgres container and
//! serves the admin at <http://127.0.0.1:3030/admin/>.
//!
//! Run with: `cargo run -p axum-admin --example serve`

use axum::Router;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:demo@localhost:55432/admindemo".to_string());
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await?;

    let admin = axum_admin::Admin::new(pool)
        .table("public", "posts", |t| {
            t.display_name("Posts").searchable(["title", "body"])
        })
        .table("public", "users", |t| {
            t.display_name("Users").searchable(["name", "email"])
        });

    let app = Router::new().nest("/admin", admin.into_router("/admin"));

    let addr = "127.0.0.1:3030";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("axum-admin demo: http://{addr}/admin/");
    axum::serve(listener, app).await?;
    Ok(())
}
