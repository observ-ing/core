//! Tap spike: shadow consumer that connects to a Tap instance, writes every
//! event into `tap_spike.event_log`, and acks. Runs alongside the existing
//! Jetstream ingester (which also writes to `event_log` when SPIKE_LOG_EVENTS=1)
//! so we can diff coverage during the observation window.
//!
//! Apply scripts/tap-spike-schema.sql before starting.
//!
//! Env vars:
//!   DATABASE_URL          Postgres connection string (required)
//!   TAP_URL               WebSocket URL (default ws://localhost:2480/channel)
//!   TAP_HTTP_URL          HTTP base for /repos/add (default http://localhost:2480)
//!   TAP_ADMIN_PASSWORD    Optional Basic auth password
//!   BOOTSTRAP_OAUTH       If "1", read oauth_sessions and POST /repos/add at startup

use std::env;
use std::time::Duration;

use clap::Parser;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tap_client::{TapConfig, TapEvent, TapSubscription};
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};

#[derive(Parser)]
#[command(about = "Tap spike: shadow consumer writing to tap_spike.event_log")]
struct Cli {
    /// Bootstrap repos via POST /repos/add from appview.oauth_sessions on startup.
    #[arg(long, env = "BOOTSTRAP_OAUTH")]
    bootstrap_oauth: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(EnvFilter::from_default_env().add_directive("tap_shadow=info".parse()?))
        .with(tracing_stackdriver::layer())
        .init();

    let cli = Cli::parse();
    let database_url = env::var("DATABASE_URL")?;
    let tap_url = env::var("TAP_URL").unwrap_or_else(|_| "ws://localhost:2480/channel".to_string());
    let tap_http = env::var("TAP_HTTP_URL").unwrap_or_else(|_| "http://localhost:2480".to_string());
    let admin_password = env::var("TAP_ADMIN_PASSWORD").ok();

    info!("connecting to database");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&database_url)
        .await?;

    sanity_check_schema(&pool).await?;

    if cli.bootstrap_oauth {
        if let Err(e) = bootstrap_from_oauth(&pool, &tap_http, admin_password.as_deref()).await {
            warn!("bootstrap_from_oauth failed: {}", e);
        }
    }

    let (event_tx, mut event_rx) = mpsc::channel(256);
    let (mut sub, ack) = TapSubscription::new(
        TapConfig {
            url: tap_url.clone(),
            admin_password,
        },
        event_tx,
    );

    let sub_handle = tokio::spawn(async move {
        if let Err(e) = sub.run().await {
            error!("tap subscription error: {}", e);
        }
    });

    let mut count = 0u64;
    while let Some(evt) = event_rx.recv().await {
        match &evt {
            TapEvent::Connected => info!("tap connected"),
            TapEvent::Disconnected => warn!("tap disconnected"),
            TapEvent::Error(e) => warn!("tap error: {}", e),
            TapEvent::Identity(i) => {
                // Identity events are ack-only — nothing to log to event_log.
                info!(did = %i.did, handle = %i.handle, status = %i.status, "identity");
            }
            TapEvent::Record(r) => {
                if let Err(e) = sqlx::query(
                    "INSERT INTO tap_spike.event_log
                        (source, did, collection, rkey, cid, action, live, tap_event_id)
                     VALUES ('tap', $1, $2, $3, $4, $5, $6, $7)",
                )
                .bind(&r.did)
                .bind(&r.collection)
                .bind(&r.rkey)
                .bind(r.cid.as_deref())
                .bind(&r.action)
                .bind(r.live)
                .bind(r.id as i64)
                .execute(&pool)
                .await
                {
                    error!("event_log insert failed for id={}: {}", r.id, e);
                    // Don't ack on insert failure — let Tap redeliver.
                    continue;
                }

                count += 1;
                if count % 100 == 0 {
                    info!(count, "events written");
                }
            }
        }
        if let Some(id) = evt.id() {
            if let Err(e) = ack.ack(id).await {
                error!("ack failed for id={}: {}", id, e);
                break;
            }
        }
    }

    drop(ack);
    let _ = sub_handle.await;
    Ok(())
}

async fn sanity_check_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'tap_spike' AND table_name = 'event_log'
         )",
    )
    .fetch_one(pool)
    .await?;
    if !exists {
        return Err(sqlx::Error::Configuration(
            "tap_spike.event_log not found — run scripts/tap-spike-schema.sql first".into(),
        ));
    }
    Ok(())
}

async fn bootstrap_from_oauth(
    pool: &PgPool,
    tap_http: &str,
    admin_password: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    // appview.oauth_sessions stores the DID in the `key` column.
    let dids: Vec<String> = sqlx::query_scalar("SELECT DISTINCT key FROM appview.oauth_sessions")
        .fetch_all(pool)
        .await?;
    if dids.is_empty() {
        info!("oauth_sessions empty, nothing to bootstrap");
        return Ok(());
    }
    info!(count = dids.len(), "bootstrapping repos via /repos/add");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let mut req = client
        .post(format!("{}/repos/add", tap_http.trim_end_matches('/')))
        .json(&serde_json::json!({ "dids": dids }));
    if let Some(pw) = admin_password {
        req = req.basic_auth("admin", Some(pw));
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        return Err(format!(
            "/repos/add returned {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        )
        .into());
    }
    info!("bootstrap complete");
    Ok(())
}
