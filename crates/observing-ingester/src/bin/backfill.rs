//! Backfill records from AT Protocol repos into the local database.
//!
//! For each DID provided, resolves their PDS endpoint, lists all records
//! under each collection, and processes them through the same pipeline
//! the firehose ingester uses.
//!
//! Usage:
//!   cargo run --bin backfill -- did:plc:abc did:plc:xyz
//!   cargo run --bin backfill -- --all
//!   cargo run --bin backfill -- --collection occurrence did:plc:abc
//!   cargo run --bin backfill -- --dry-run did:plc:abc

use std::time::Duration;

use chrono::Utc;
use clap::Parser;
use observing_db::processing;
use reqwest::Client;
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::{error, info, warn};

const OCCURRENCE_COLLECTION: &str = "ing.observ.temp.occurrence";
const IDENTIFICATION_COLLECTION: &str = "ing.observ.temp.identification";
const COMMENT_COLLECTION: &str = "ing.observ.temp.comment";
const INTERACTION_COLLECTION: &str = "ing.observ.temp.interaction";
const LIKE_COLLECTION: &str = "ing.observ.temp.like";

const ALL_COLLECTIONS: &[(&str, &str)] = &[
    ("occurrence", OCCURRENCE_COLLECTION),
    ("identification", IDENTIFICATION_COLLECTION),
    ("comment", COMMENT_COLLECTION),
    ("interaction", INTERACTION_COLLECTION),
    ("like", LIKE_COLLECTION),
];

#[derive(Parser)]
#[command(about = "Backfill AT Protocol records into the local database")]
struct Cli {
    /// DIDs to backfill (e.g. did:plc:abc did:plc:xyz)
    dids: Vec<String>,

    /// Backfill all known DIDs from the oauth_sessions table
    #[arg(long)]
    all: bool,

    /// Comma-separated list of collections to backfill (default: all)
    #[arg(long, value_name = "NAMES")]
    collection: Option<String>,

    /// Show what would be done without writing to the database
    #[arg(long)]
    dry_run: bool,
}

/// Response from com.atproto.repo.listRecords
#[derive(Deserialize)]
struct ListRecordsResponse {
    records: Vec<Record>,
    cursor: Option<String>,
}

/// A single record from listRecords
#[derive(Deserialize)]
struct Record {
    uri: String,
    cid: String,
    value: serde_json::Value,
}

/// Resolve a DID to its PDS endpoint via plc.directory.
async fn resolve_pds(client: &Client, did: &str) -> Option<String> {
    let url = if did.starts_with("did:plc:") {
        format!("https://plc.directory/{did}")
    } else if did.starts_with("did:web:") {
        let domain = did.strip_prefix("did:web:").unwrap().replace("%3A", ":");
        format!("https://{domain}/.well-known/did.json")
    } else {
        return None;
    };

    let doc: serde_json::Value = client.get(&url).send().await.ok()?.json().await.ok()?;

    doc["service"]
        .as_array()?
        .iter()
        .find(|s| s["id"].as_str() == Some("#atproto_pds"))
        .and_then(|s| s["serviceEndpoint"].as_str())
        .map(|s| s.to_string())
}

/// List all records for a DID + collection from their PDS, paginating through results.
async fn list_records(
    client: &Client,
    pds: &str,
    did: &str,
    collection: &str,
) -> Result<Vec<Record>, Box<dyn std::error::Error>> {
    let mut all_records = Vec::new();
    let mut cursor: Option<String> = None;

    loop {
        let mut url = format!(
            "{}/xrpc/com.atproto.repo.listRecords?repo={}&collection={}&limit=100",
            pds, did, collection,
        );
        if let Some(ref c) = cursor {
            url.push_str(&format!("&cursor={c}"));
        }

        let resp: ListRecordsResponse = client
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let count = resp.records.len();
        all_records.extend(resp.records);

        match resp.cursor {
            Some(c) if count > 0 => cursor = Some(c),
            _ => break,
        }
    }

    Ok(all_records)
}

/// Process a single record through the ingester pipeline and upsert into the DB.
async fn process_record(
    pool: &PgPool,
    collection: &str,
    record: &Record,
    did: &str,
    dry_run: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    if dry_run {
        return Ok(());
    }

    let now = Utc::now();

    match collection {
        OCCURRENCE_COLLECTION => {
            let parsed = processing::occurrence_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
            )?;
            observing_db::occurrences::upsert(pool, &parsed.params).await?;
            let co_observers =
                processing::extract_co_observers(parsed.recorded_by.as_deref(), did);
            observing_db::observers::sync(pool, &record.uri, did, &co_observers).await?;
        }
        IDENTIFICATION_COLLECTION => {
            let params = processing::identification_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
                now,
            )?;
            observing_db::identifications::upsert(pool, &params).await?;
        }
        COMMENT_COLLECTION => {
            let params = processing::comment_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
                now,
            )?;
            observing_db::comments::upsert(pool, &params).await?;
        }
        INTERACTION_COLLECTION => {
            let params = processing::interaction_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
                now,
            )?;
            observing_db::interactions::upsert(pool, &params).await?;
        }
        LIKE_COLLECTION => {
            // Only store likes whose subject is an occurrence
            let is_occurrence_like = record
                .value
                .get("subject")
                .and_then(|s| s.get("uri"))
                .and_then(|u| u.as_str())
                .is_some_and(|uri| uri.contains(OCCURRENCE_COLLECTION));

            if !is_occurrence_like {
                return Ok(());
            }

            let params = processing::like_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
                now,
            )?;
            observing_db::likes::create(pool, &params).await?;
        }
        _ => {}
    }

    Ok(())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backfill=info".into()),
        )
        .init();

    let cli = Cli::parse();

    if cli.dids.is_empty() && !cli.all {
        eprintln!("Provide DIDs as arguments or use --all to backfill all known users");
        std::process::exit(1);
    }

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/observing".into());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Resolve which DIDs to backfill
    let dids: Vec<String> = if cli.all {
        sqlx::query_scalar("SELECT key FROM oauth_sessions")
            .fetch_all(&pool)
            .await
            .expect("Failed to query oauth_sessions")
    } else {
        cli.dids.clone()
    };

    // Resolve which collections to backfill
    let collections: Vec<(&str, &str)> = match &cli.collection {
        Some(names) => {
            let filter: Vec<&str> = names.split(',').map(|s| s.trim()).collect();
            ALL_COLLECTIONS
                .iter()
                .filter(|(name, _)| filter.contains(name))
                .copied()
                .collect()
        }
        None => ALL_COLLECTIONS.to_vec(),
    };

    if cli.dry_run {
        println!("=== DRY RUN MODE ===\n");
    }

    let client = Client::new();
    let mut total_processed = 0usize;
    let mut total_failed = 0usize;

    for did in &dids {
        let pds = match resolve_pds(&client, did).await {
            Some(p) => p,
            None => {
                error!("[{did}] Could not resolve PDS endpoint — skipping");
                continue;
            }
        };
        info!("[{did}] PDS: {pds}");

        for &(short_name, collection) in &collections {
            let records = match list_records(&client, &pds, did, collection).await {
                Ok(r) => r,
                Err(e) => {
                    warn!("[{did}] Failed to list {short_name}: {e}");
                    continue;
                }
            };

            if records.is_empty() {
                continue;
            }

            info!(
                "[{did}] Found {} {short_name} records",
                records.len()
            );

            for record in &records {
                match process_record(&pool, collection, record, did, cli.dry_run).await {
                    Ok(()) => {
                        total_processed += 1;
                    }
                    Err(e) => {
                        warn!("  FAIL {}: {e}", record.uri);
                        total_failed += 1;
                    }
                }
            }
        }
    }

    println!("\n=== Backfill complete ===");
    println!("  Processed: {total_processed}");
    println!("  Failed: {total_failed}");
}
