//! One-shot migration runner.
//!
//! Connects to the database using `DATABASE_URL` (must point at a role with
//! DDL privileges), runs all pending sqlx migrations, and exits. Packaged as
//! its own Cloud Run Job so that migrations happen as an explicit deploy step
//! instead of a side effect of a service container's startup.

use sqlx::postgres::PgPoolOptions;
use std::process::ExitCode;
use std::time::Duration;
use tracing::{error, info};
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> ExitCode {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("observing_migrate=info,sqlx::migrate=info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(v) => v,
        Err(_) => {
            error!("DATABASE_URL is required");
            return ExitCode::from(2);
        }
    };

    info!("Connecting with admin credentials to run migrations");
    let pool = match PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(30))
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "Failed to connect to database");
            return ExitCode::from(1);
        }
    };

    if let Err(e) = observing_db::migrate::migrate(&pool).await {
        error!(error = %e, "Migration failed");
        return ExitCode::from(1);
    }

    info!("Migrations applied successfully");
    ExitCode::SUCCESS
}
