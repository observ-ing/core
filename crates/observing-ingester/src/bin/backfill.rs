//! Backfill records from AT Protocol repos into the local database.
//!
//! For each DID provided, resolves their PDS endpoint, lists all records
//! under each collection, and processes them through the same pipeline
//! the firehose ingester uses.
//!
//! Automatically resolves dependencies: if identifications, comments, or
//! likes reference occurrences from other users, those occurrences are
//! backfilled first.
//!
//! Usage:
//!   cargo run --bin backfill -- did:plc:abc did:plc:xyz
//!   cargo run --bin backfill -- --all
//!   cargo run --bin backfill -- --collection occurrence did:plc:abc
//!   cargo run --bin backfill -- --dry-run did:plc:abc

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::Utc;
use clap::Parser;
use observing_db::processing;
use reqwest::Client;
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::{error, info, warn};

const OCCURRENCE_COLLECTION: &str = "bio.lexicons.temp.occurrence";
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

    /// Fetch and parse records without writing to the database (no DB required)
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

/// A batch of fetched records for one DID, grouped by collection.
struct FetchedRecords {
    /// (short_name, collection_nsid, records)
    collections: Vec<(&'static str, &'static str, Vec<Record>)>,
}

/// Extract the DID from an AT URI (at://did:plc:xxx/collection/rkey).
fn did_from_uri(uri: &str) -> Option<&str> {
    uri.strip_prefix("at://")?.split('/').next()
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

/// Check if a record's subject references a known collection namespace.
/// Records referencing old/unknown namespaces are skipped during backfill.
fn has_known_subject(record: &Record) -> bool {
    let subject_uri = record
        .value
        .get("subject")
        .and_then(|s| s.get("uri"))
        .and_then(|u| u.as_str());

    match subject_uri {
        Some(uri) => uri.contains("/ing.observ.") || uri.contains("/bio.lexicons."),
        None => true, // No subject (e.g. occurrences) — always process
    }
}

/// Check if a URI references an occurrence record.
fn is_occurrence_uri(uri: &str) -> bool {
    uri.contains("/bio.lexicons.temp.occurrence/")
}

/// Check that any referenced occurrence URIs actually exist in our fetched data.
/// This filters out records pointing to phantom occurrences (e.g. from partial migrations).
fn subject_occurrence_exists(record: &Record, known_uris: &HashSet<String>) -> bool {
    // Check subject.uri for identifications/comments/likes
    if let Some(uri) = record
        .value
        .get("subject")
        .and_then(|s| s.get("uri"))
        .and_then(|u| u.as_str())
    {
        if is_occurrence_uri(uri) && !known_uris.contains(uri) {
            return false;
        }
    }
    // Check subjectA/subjectB occurrence URIs for interactions
    for key in &["subjectA", "subjectB"] {
        if let Some(uri) = record
            .value
            .get(key)
            .and_then(|s| s.get("occurrence"))
            .and_then(|o| o.get("uri"))
            .and_then(|u| u.as_str())
        {
            if is_occurrence_uri(uri) && !known_uris.contains(uri) {
                return false;
            }
        }
    }
    true
}

/// Extract referenced DIDs from subject.uri fields in non-occurrence records.
fn extract_referenced_dids(records: &[&Record], exclude: &HashSet<String>) -> HashSet<String> {
    let mut dids = HashSet::new();
    for record in records {
        // subject.uri (identifications, comments, likes)
        if let Some(uri) = record
            .value
            .get("subject")
            .and_then(|s| s.get("uri"))
            .and_then(|u| u.as_str())
        {
            if let Some(did) = did_from_uri(uri) {
                if !exclude.contains(did) {
                    dids.insert(did.to_string());
                }
            }
        }
        // subjectA.occurrence.uri / subjectB.occurrence.uri (interactions)
        for key in &["subjectA", "subjectB"] {
            if let Some(uri) = record
                .value
                .get(key)
                .and_then(|s| s.get("occurrence"))
                .and_then(|o| o.get("uri"))
                .and_then(|u| u.as_str())
            {
                if let Some(did) = did_from_uri(uri) {
                    if !exclude.contains(did) {
                        dids.insert(did.to_string());
                    }
                }
            }
        }
    }
    dids
}

/// Parse a record through the processing pipeline (validates deserialization).
fn parse_record(
    collection: &str,
    record: &Record,
    did: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let now = Utc::now();

    match collection {
        OCCURRENCE_COLLECTION => {
            processing::occurrence_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
            )?;
        }
        IDENTIFICATION_COLLECTION => {
            processing::identification_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
                now,
            )?;
        }
        COMMENT_COLLECTION => {
            processing::comment_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
                now,
            )?;
        }
        INTERACTION_COLLECTION => {
            processing::interaction_from_json(
                &record.value,
                record.uri.clone(),
                record.cid.clone(),
                did.to_string(),
                now,
            )?;
        }
        LIKE_COLLECTION => {
            let is_occurrence_like = record
                .value
                .get("subject")
                .and_then(|s| s.get("uri"))
                .and_then(|u| u.as_str())
                .is_some_and(is_occurrence_uri);

            if is_occurrence_like {
                processing::like_from_json(
                    &record.value,
                    record.uri.clone(),
                    record.cid.clone(),
                    did.to_string(),
                    now,
                )?;
            }
        }
        _ => {}
    }

    Ok(())
}

/// Parse a record and write it to the database.
async fn process_and_store(
    pool: &PgPool,
    collection: &str,
    record: &Record,
    did: &str,
) -> Result<(), Box<dyn std::error::Error>> {
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
            let co_observers = processing::extract_co_observers(parsed.recorded_by.as_deref(), did);
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
            let is_occurrence_like = record
                .value
                .get("subject")
                .and_then(|s| s.get("uri"))
                .and_then(|u| u.as_str())
                .is_some_and(is_occurrence_uri);

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

/// Backfill occurrences for a single DID and return (processed, failed, occurrence_uris).
async fn backfill_occurrences(
    client: &Client,
    pool: Option<&PgPool>,
    did: &str,
    dry_run: bool,
) -> (usize, usize, HashSet<String>) {
    let mut processed = 0;
    let mut failed = 0;
    let mut uris = HashSet::new();

    let pds = match resolve_pds(client, did).await {
        Some(p) => p,
        None => {
            error!("[{did}] Could not resolve PDS endpoint");
            return (0, 0, uris);
        }
    };

    let records = list_records(client, &pds, did, OCCURRENCE_COLLECTION)
        .await
        .unwrap_or_default();

    if records.is_empty() {
        return (0, 0, uris);
    }

    info!(
        "[{did}] Found {} occurrence records (dependency)",
        records.len()
    );

    for record in &records {
        uris.insert(record.uri.clone());

        let result = if dry_run {
            parse_record(OCCURRENCE_COLLECTION, record, did)
        } else {
            process_and_store(pool.unwrap(), OCCURRENCE_COLLECTION, record, did).await
        };

        match result {
            Ok(()) => processed += 1,
            Err(e) => {
                warn!("  FAIL {}: {e}", record.uri);
                failed += 1;
            }
        }
    }

    (processed, failed, uris)
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

    if cli.all && cli.dry_run {
        eprintln!("--all requires a database connection and cannot be used with --dry-run");
        std::process::exit(1);
    }

    // Only connect to the database when not in dry-run mode
    let pool = if cli.dry_run {
        None
    } else {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://localhost/observing".into());
        Some(
            PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(5))
                .connect(&database_url)
                .await
                .expect("Failed to connect to database"),
        )
    };

    // Resolve which DIDs to backfill
    let dids: Vec<String> = if cli.all {
        let pool = pool.as_ref().unwrap();
        sqlx::query_scalar("SELECT key FROM oauth_sessions")
            .fetch_all(pool)
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
        println!("=== DRY RUN MODE (parse only, no DB writes) ===\n");
    }

    let client = Client::new();
    let mut total_processed = 0usize;
    let mut total_failed = 0usize;

    // Phase 1: Fetch all records for requested DIDs
    let did_set: HashSet<String> = dids.iter().cloned().collect();
    let mut all_fetched: HashMap<String, FetchedRecords> = HashMap::new();
    // Track all occurrence URIs we've fetched — used to skip records
    // referencing non-existent occurrences (e.g. orphans from prior migrations).
    let mut known_occurrence_uris: HashSet<String> = HashSet::new();

    for did in &dids {
        let pds = match resolve_pds(&client, did).await {
            Some(p) => p,
            None => {
                error!("[{did}] Could not resolve PDS endpoint — skipping");
                continue;
            }
        };
        info!("[{did}] PDS: {pds}");

        let mut collections_vec = Vec::new();
        for &(short_name, collection) in &collections {
            let records = match list_records(&client, &pds, did, collection).await {
                Ok(r) => r,
                Err(e) => {
                    warn!("[{did}] Failed to list {short_name}: {e}");
                    continue;
                }
            };

            if !records.is_empty() {
                info!("[{did}] Found {} {short_name} records", records.len());
            }
            if collection == OCCURRENCE_COLLECTION {
                for r in &records {
                    known_occurrence_uris.insert(r.uri.clone());
                }
            }
            collections_vec.push((short_name, collection, records));
        }
        all_fetched.insert(
            did.clone(),
            FetchedRecords {
                collections: collections_vec,
            },
        );
    }

    // Phase 2: Find referenced DIDs whose occurrences we need as dependencies
    let mut all_non_occurrence_records: Vec<&Record> = Vec::new();
    for fetched in all_fetched.values() {
        for (_, collection, records) in &fetched.collections {
            if *collection != OCCURRENCE_COLLECTION {
                all_non_occurrence_records.extend(records);
            }
        }
    }

    let dep_dids = extract_referenced_dids(&all_non_occurrence_records, &did_set);
    if !dep_dids.is_empty() {
        info!(
            "Backfilling occurrences from {} referenced user(s)...",
            dep_dids.len()
        );
        for dep_did in &dep_dids {
            let (p, f, uris) =
                backfill_occurrences(&client, pool.as_ref(), dep_did, cli.dry_run).await;
            total_processed += p;
            total_failed += f;
            known_occurrence_uris.extend(uris);
        }
    }

    // Phase 3: Process all records for the requested DIDs
    for did in &dids {
        let fetched = match all_fetched.get(did) {
            Some(r) => r,
            None => continue,
        };

        for (_, collection, records) in &fetched.collections {
            for record in records {
                if !has_known_subject(record) {
                    info!("  SKIP {} (unknown namespace)", record.uri);
                    continue;
                }

                if !subject_occurrence_exists(record, &known_occurrence_uris) {
                    info!("  SKIP {} (referenced occurrence not found)", record.uri);
                    continue;
                }

                let result = if cli.dry_run {
                    parse_record(collection, record, did)
                } else {
                    process_and_store(pool.as_ref().unwrap(), collection, record, did).await
                };

                match result {
                    Ok(()) => total_processed += 1,
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

    if total_failed > 0 {
        std::process::exit(1);
    }
}
