//! Migrate AT Protocol records from `org.rwell.test.*` to `ing.observ.temp.*`.
//!
//! For each record under the old collection, this script:
//! 1. Fetches the record from the user's PDS via `getRecord`
//! 2. Creates a new record under the `ing.observ.temp.*` collection
//! 3. Deletes the old record from the PDS
//! 4. Updates the local database URI and CID
//!
//! After migrating occurrences, subject_uri references in dependent tables
//! (identifications, comments, interactions, likes) are also updated.
//!
//! Requires: DATABASE_URL and PUBLIC_URL environment variables.
//!
//! Usage:
//!   cargo run --bin migrate-records
//!   cargo run --bin migrate-records -- --dry-run
//!   cargo run --bin migrate-records -- --collection occurrence
//!   cargo run --bin migrate-records -- --collection identification,comment

// Re-use appview internals
#[path = "../oauth_store.rs"]
mod oauth_store;
#[path = "../resolver.rs"]
mod resolver;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use atrium_identity::did::{CommonDidResolver, CommonDidResolverConfig, DEFAULT_PLC_DIRECTORY_URL};
use atrium_identity::handle::{AtprotoHandleResolver, AtprotoHandleResolverConfig};
use atrium_oauth::{DefaultHttpClient, OAuthClient};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::{error, info, warn};

use oauth_store::{PgSessionStore, PgStateStore};
use resolver::HickoryDnsTxtResolver;

/// Mapping from old collection NSID to new collection NSID.
const COLLECTION_MAP: &[(&str, &str)] = &[
    ("org.rwell.test.occurrence", "ing.observ.temp.occurrence"),
    (
        "org.rwell.test.identification",
        "ing.observ.temp.identification",
    ),
    ("org.rwell.test.comment", "ing.observ.temp.comment"),
    ("org.rwell.test.interaction", "ing.observ.temp.interaction"),
    ("org.rwell.test.like", "ing.observ.temp.like"),
];

/// Database table and URI column for each old collection.
const TABLE_MAP: &[(&str, &str)] = &[
    ("org.rwell.test.occurrence", "occurrences"),
    ("org.rwell.test.identification", "identifications"),
    ("org.rwell.test.comment", "comments"),
    ("org.rwell.test.interaction", "interactions"),
    ("org.rwell.test.like", "likes"),
];

/// Tables with subject_uri columns that reference occurrence URIs.
const SUBJECT_URI_TABLES: &[&str] = &["identifications", "comments", "interactions", "likes"];

type OAuthClientType = OAuthClient<
    PgStateStore,
    PgSessionStore,
    CommonDidResolver<DefaultHttpClient>,
    AtprotoHandleResolver<HickoryDnsTxtResolver, DefaultHttpClient>,
>;

type OAuthSessionType = atrium_oauth::OAuthSession<
    DefaultHttpClient,
    CommonDidResolver<DefaultHttpClient>,
    AtprotoHandleResolver<HickoryDnsTxtResolver, DefaultHttpClient>,
    PgSessionStore,
>;

type AgentType = atrium_api::agent::Agent<OAuthSessionType>;

#[derive(sqlx::FromRow)]
struct RecordRow {
    uri: String,
    #[allow(dead_code)]
    cid: String,
    did: String,
}

fn create_oauth_client(pool: PgPool, public_url: Option<&str>) -> OAuthClientType {
    let http_client = Arc::new(DefaultHttpClient::default());

    let resolver = atrium_oauth::OAuthResolverConfig {
        did_resolver: CommonDidResolver::new(CommonDidResolverConfig {
            plc_directory_url: DEFAULT_PLC_DIRECTORY_URL.to_string(),
            http_client: http_client.clone(),
        }),
        handle_resolver: AtprotoHandleResolver::new(AtprotoHandleResolverConfig {
            dns_txt_resolver: HickoryDnsTxtResolver::default(),
            http_client: http_client.clone(),
        }),
        authorization_server_metadata: Default::default(),
        protected_resource_metadata: Default::default(),
    };

    let scopes = vec![
        atrium_oauth::Scope::Known(atrium_oauth::KnownScope::Atproto),
        atrium_oauth::Scope::Known(atrium_oauth::KnownScope::TransitionGeneric),
    ];

    let state_store = PgStateStore::new(pool.clone());
    let session_store = PgSessionStore::new(pool);

    macro_rules! build_client {
        ($metadata:expr) => {
            OAuthClient::new(atrium_oauth::OAuthClientConfig {
                client_metadata: $metadata,
                keys: None,
                resolver,
                state_store,
                session_store,
            })
            .expect("failed to create OAuth client")
        };
    }

    if let Some(public_url) = public_url {
        build_client!(atrium_oauth::AtprotoClientMetadata {
            client_id: format!("{public_url}/oauth/client-metadata.json"),
            client_uri: Some(public_url.to_string()),
            redirect_uris: vec![format!("{public_url}/oauth/callback")],
            token_endpoint_auth_method: atrium_oauth::AuthMethod::None,
            grant_types: vec![
                atrium_oauth::GrantType::AuthorizationCode,
                atrium_oauth::GrantType::RefreshToken,
            ],
            scopes,
            jwks_uri: None,
            token_endpoint_auth_signing_alg: None,
        })
    } else {
        build_client!(atrium_oauth::AtprotoLocalhostClientMetadata {
            redirect_uris: Some(vec!["http://127.0.0.1:3000/oauth/callback".to_string()]),
            scopes: Some(scopes),
        })
    }
}

async fn restore_agent(
    oauth_client: &OAuthClientType,
    did: &str,
) -> Result<AgentType, Box<dyn std::error::Error>> {
    let did_parsed = atrium_api::types::string::Did::new(did.to_string())?;
    let session = oauth_client.restore(&did_parsed).await?;
    Ok(atrium_api::agent::Agent::new(session))
}

/// Extract the rkey from an AT URI (last path segment).
fn rkey_from_uri(uri: &str) -> Option<&str> {
    uri.rsplit('/').next()
}

/// Fetch a record from the PDS and return its value as JSON.
async fn get_record(
    agent: &AgentType,
    did: &atrium_api::types::string::Did,
    collection: &str,
    rkey: &str,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let output = agent
        .api
        .com
        .atproto
        .repo
        .get_record(
            atrium_api::com::atproto::repo::get_record::ParametersData {
                collection: collection.parse()?,
                repo: atrium_api::types::string::AtIdentifier::Did(did.clone()),
                rkey: rkey.parse()?,
                cid: None,
            }
            .into(),
        )
        .await?;

    let value = serde_json::to_value(&output.value)?;
    Ok(value)
}

/// Create a record under a new collection, returning (uri, cid).
async fn create_record(
    agent: &AgentType,
    did: &atrium_api::types::string::Did,
    new_collection: &str,
    mut value: serde_json::Value,
) -> Result<(String, String), Box<dyn std::error::Error>> {
    // Update $type to the new collection NSID
    value["$type"] = serde_json::json!(new_collection);

    let output = agent
        .api
        .com
        .atproto
        .repo
        .create_record(
            atrium_api::com::atproto::repo::create_record::InputData {
                collection: new_collection.parse()?,
                record: serde_json::from_value(value)?,
                repo: atrium_api::types::string::AtIdentifier::Did(did.clone()),
                rkey: None,
                swap_commit: None,
                validate: None,
            }
            .into(),
        )
        .await?;

    Ok((output.uri.clone(), output.cid.as_ref().to_string()))
}

/// Delete a record from the PDS.
async fn delete_record(
    agent: &AgentType,
    did: &atrium_api::types::string::Did,
    collection: &str,
    rkey: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    agent
        .api
        .com
        .atproto
        .repo
        .delete_record(
            atrium_api::com::atproto::repo::delete_record::InputData {
                collection: collection.parse()?,
                repo: atrium_api::types::string::AtIdentifier::Did(did.clone()),
                rkey: rkey.parse()?,
                swap_commit: None,
                swap_record: None,
            }
            .into(),
        )
        .await?;
    Ok(())
}

/// Migrate all records for a given collection type.
async fn migrate_collection(
    pool: &PgPool,
    oauth_client: &OAuthClientType,
    old_collection: &str,
    new_collection: &str,
    table: &str,
    dry_run: bool,
) -> (usize, usize, usize) {
    let mut migrated = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    // Find all records under the old collection
    let query = format!("SELECT uri, cid, did FROM {table} WHERE uri LIKE '%/{old_collection}/%'");
    let rows: Vec<RecordRow> = match sqlx::query_as(&query).fetch_all(pool).await {
        Ok(rows) => rows,
        Err(e) => {
            error!("Failed to query {table}: {e}");
            return (0, 0, 0);
        }
    };

    if rows.is_empty() {
        info!("No records found under {old_collection}. Skipping.");
        return (0, 0, 0);
    }

    // Group by DID
    let mut by_did: HashMap<String, Vec<&RecordRow>> = HashMap::new();
    for row in &rows {
        by_did.entry(row.did.clone()).or_default().push(row);
    }

    info!(
        "Found {} records under {old_collection} across {} users",
        rows.len(),
        by_did.len()
    );

    if dry_run {
        for (did, records) in &by_did {
            println!("  {did}: {} records", records.len());
            for r in records {
                println!("    {}", r.uri);
            }
        }
        return (0, 0, 0);
    }

    for (did, records) in &by_did {
        info!(
            "[{did}] Migrating {} {old_collection} records...",
            records.len()
        );

        let agent = match restore_agent(oauth_client, did).await {
            Ok(a) => a,
            Err(e) => {
                error!(
                    "[{did}] Failed to restore session: {e} — skipping {} records",
                    records.len()
                );
                skipped += records.len();
                continue;
            }
        };

        let did_parsed = atrium_api::types::string::Did::new(did.clone()).unwrap();

        for row in records {
            let rkey = match rkey_from_uri(&row.uri) {
                Some(r) => r,
                None => {
                    error!("  Invalid URI (no rkey): {}", row.uri);
                    failed += 1;
                    continue;
                }
            };

            // 1. Fetch existing record from PDS
            let value = match get_record(&agent, &did_parsed, old_collection, rkey).await {
                Ok(v) => v,
                Err(e) => {
                    error!("  FAIL getRecord {}: {e}", row.uri);
                    failed += 1;
                    continue;
                }
            };

            // 2. Create new record under new collection
            let (new_uri, new_cid) =
                match create_record(&agent, &did_parsed, new_collection, value).await {
                    Ok(r) => r,
                    Err(e) => {
                        error!("  FAIL createRecord {}: {e}", row.uri);
                        failed += 1;
                        continue;
                    }
                };

            // 3. Delete old record from PDS
            if let Err(e) = delete_record(&agent, &did_parsed, old_collection, rkey).await {
                warn!("  WARN could not delete old record {}: {e}", row.uri);
                // Continue — new record is already created
            }

            // 4. Update local database
            let update_query = format!("UPDATE {table} SET uri = $1, cid = $2 WHERE uri = $3");
            match sqlx::query(&update_query)
                .bind(&new_uri)
                .bind(&new_cid)
                .bind(&row.uri)
                .execute(pool)
                .await
            {
                Ok(_) => {
                    info!("  OK {} -> {}", row.uri, new_uri);
                    migrated += 1;
                }
                Err(e) => {
                    error!("  FAIL update DB for {}: {e}", row.uri);
                    failed += 1;
                }
            }
        }
    }

    (migrated, skipped, failed)
}

/// After occurrence URIs have been migrated, update subject_uri references
/// in dependent tables.
async fn update_subject_uris(pool: &PgPool, dry_run: bool) {
    let old_pattern = "org.rwell.test.occurrence";
    let new_collection = "ing.observ.temp.occurrence";

    for table in SUBJECT_URI_TABLES {
        let count_query = format!(
            "SELECT COUNT(*) as count FROM {table} WHERE subject_uri LIKE '%/{old_pattern}/%'"
        );
        let count: (i64,) = match sqlx::query_as(&count_query).fetch_one(pool).await {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to count subject_uri refs in {table}: {e}");
                continue;
            }
        };

        if count.0 == 0 {
            continue;
        }

        info!("{table}: {} subject_uri references to update", count.0);

        if dry_run {
            continue;
        }

        let update_query = format!(
            "UPDATE {table} SET subject_uri = REPLACE(subject_uri, '/{old_pattern}/', '/{new_collection}/') \
             WHERE subject_uri LIKE '%/{old_pattern}/%'"
        );
        match sqlx::query(&update_query).execute(pool).await {
            Ok(result) => {
                info!(
                    "  Updated {} subject_uri rows in {table}",
                    result.rows_affected()
                );
            }
            Err(e) => {
                error!("  FAIL updating subject_uri in {table}: {e}");
            }
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "migrate_records=info".into()),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let collection_filter: Option<Vec<&str>> = args
        .windows(2)
        .find(|w| w[0] == "--collection")
        .map(|w| w[1].split(',').map(|s| s.trim()).collect());

    if dry_run {
        println!("=== DRY RUN MODE — no changes will be made ===\n");
    }

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/observing".into());
    let public_url = std::env::var("PUBLIC_URL").ok();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let oauth_client = create_oauth_client(pool.clone(), public_url.as_deref());

    let mut total_migrated = 0usize;
    let mut total_skipped = 0usize;
    let mut total_failed = 0usize;

    for &(old_collection, new_collection) in COLLECTION_MAP {
        // Short name is the last segment: e.g. "occurrence"
        let short_name = old_collection.rsplit('.').next().unwrap();

        // Apply filter if specified
        if let Some(ref filter) = collection_filter {
            if !filter.contains(&short_name) {
                continue;
            }
        }

        let table = TABLE_MAP
            .iter()
            .find(|(c, _)| *c == old_collection)
            .map(|(_, t)| *t)
            .unwrap();

        println!("\n--- Migrating {old_collection} -> {new_collection} ---");
        let (m, s, f) = migrate_collection(
            &pool,
            &oauth_client,
            old_collection,
            new_collection,
            table,
            dry_run,
        )
        .await;
        total_migrated += m;
        total_skipped += s;
        total_failed += f;
    }

    // Update subject_uri references after occurrence migration
    let should_update_subjects = collection_filter
        .as_ref()
        .is_none_or(|f| f.contains(&"occurrence"));
    if should_update_subjects {
        println!("\n--- Updating subject_uri references ---");
        update_subject_uris(&pool, dry_run).await;
    }

    println!("\n=== Migration complete ===");
    println!("  Migrated: {total_migrated}");
    println!("  Skipped (no session): {total_skipped}");
    println!("  Failed: {total_failed}");
}
