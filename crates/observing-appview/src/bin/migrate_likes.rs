//! Migrate likes from `app.bsky.feed.like` to `ing.observ.temp.like`.
//!
//! For each like stored under the old collection, this script:
//! 1. Creates a new record under `ing.observ.temp.like` on the user's PDS
//! 2. Deletes the old `app.bsky.feed.like` record from the PDS
//! 3. Updates the local database row with the new URI and CID
//!
//! Requires the same env vars as the appview: DATABASE_URL and PUBLIC_URL.
//!
//! Usage:
//!   cargo run --bin migrate-likes
//!   cargo run --bin migrate-likes -- --dry-run

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
use chrono::NaiveDateTime;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri, Cid, Datetime};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use observing_lexicons::ing_observ::temp::like::Like;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use oauth_store::{PgSessionStore, PgStateStore};
use resolver::HickoryDnsTxtResolver;

const OLD_COLLECTION: &str = "app.bsky.feed.like";

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
struct LikeRow {
    uri: String,
    #[allow(dead_code)]
    cid: String,
    did: String,
    subject_uri: String,
    subject_cid: String,
    created_at: NaiveDateTime,
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

async fn create_like_record(
    agent: &AgentType,
    did: &atrium_api::types::string::Did,
    subject_uri: &str,
    subject_cid: &str,
    created_at: NaiveDateTime,
) -> Result<atrium_api::com::atproto::repo::create_record::Output, Box<dyn std::error::Error>> {
    let at_uri = AtUri::new(subject_uri)?;
    let cid = Cid::from(subject_cid.to_string());
    let dt = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(created_at, chrono::Utc);

    let record = Like::new()
        .created_at(Datetime::new(dt.fixed_offset()))
        .subject(StrongRef::new().uri(at_uri).cid(cid).build())
        .build();

    let mut value = serde_json::to_value(&record)?;
    value["$type"] = serde_json::json!(Like::NSID);

    let output = agent
        .api
        .com
        .atproto
        .repo
        .create_record(
            atrium_api::com::atproto::repo::create_record::InputData {
                collection: Like::NSID.parse()?,
                record: serde_json::from_value(value)?,
                repo: atrium_api::types::string::AtIdentifier::Did(did.clone()),
                rkey: None,
                swap_commit: None,
                validate: None,
            }
            .into(),
        )
        .await?;

    Ok(output)
}

async fn delete_old_record(
    agent: &AgentType,
    did: &atrium_api::types::string::Did,
    uri: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let rkey = uri.rsplit('/').next().ok_or("invalid URI: no rkey")?;

    agent
        .api
        .com
        .atproto
        .repo
        .delete_record(
            atrium_api::com::atproto::repo::delete_record::InputData {
                collection: OLD_COLLECTION.parse()?,
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

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "migrate_likes=info".into()),
        )
        .init();

    let dry_run = std::env::args().any(|a| a == "--dry-run");

    if dry_run {
        println!("=== DRY RUN MODE — no changes will be made ===\n");
    }

    // Connect to database
    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/observing".into());
    let public_url = std::env::var("PUBLIC_URL").ok();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Find all likes under the old collection
    let old_likes: Vec<LikeRow> = sqlx::query_as(
        "SELECT uri, cid, did, subject_uri, subject_cid, created_at FROM likes WHERE uri LIKE '%/app.bsky.feed.like/%'"
    )
    .fetch_all(&pool)
    .await
    .expect("Failed to query likes");

    if old_likes.is_empty() {
        println!("No likes found under {OLD_COLLECTION}. Nothing to migrate.");
        return;
    }

    // Group by DID
    let mut by_did: HashMap<String, Vec<&LikeRow>> = HashMap::new();
    for like in &old_likes {
        by_did.entry(like.did.clone()).or_default().push(like);
    }

    println!(
        "Found {} likes under {OLD_COLLECTION} across {} users\n",
        old_likes.len(),
        by_did.len()
    );

    if dry_run {
        for (did, likes) in &by_did {
            println!("  {did}: {} likes", likes.len());
            for like in likes {
                println!("    {} -> {}", like.uri, like.subject_uri);
            }
        }
        return;
    }

    // Set up OAuth client to restore sessions
    let oauth_client = create_oauth_client(pool.clone(), public_url.as_deref());

    let mut total_migrated = 0;
    let mut total_skipped = 0;
    let mut total_failed = 0;

    for (did, likes) in &by_did {
        println!("[{did}] Migrating {} likes...", likes.len());

        // Restore OAuth session for this user
        let agent = match restore_agent(&oauth_client, did).await {
            Ok(agent) => agent,
            Err(e) => {
                eprintln!(
                    "[{did}] Failed to restore session: {e} — skipping {} likes",
                    likes.len()
                );
                total_skipped += likes.len();
                continue;
            }
        };

        let did_parsed = atrium_api::types::string::Did::new(did.clone()).unwrap();

        for like in likes {
            // 1. Create new record under ing.observ.temp.like
            let output = match create_like_record(
                &agent,
                &did_parsed,
                &like.subject_uri,
                &like.subject_cid,
                like.created_at,
            )
            .await
            {
                Ok(output) => output,
                Err(e) => {
                    eprintln!("  FAIL create {}: {e}", like.uri);
                    total_failed += 1;
                    continue;
                }
            };

            let new_uri = output.uri.clone();
            let new_cid = output.cid.as_ref().to_string();

            // 2. Delete old record from PDS
            if let Err(e) = delete_old_record(&agent, &did_parsed, &like.uri).await {
                eprintln!("  WARN could not delete old record {}: {e}", like.uri);
                // Continue anyway — the new record is already created
            }

            // 3. Update local database
            let result = sqlx::query("UPDATE likes SET uri = $1, cid = $2 WHERE uri = $3")
                .bind(&new_uri)
                .bind(&new_cid)
                .bind(&like.uri)
                .execute(&pool)
                .await;

            match result {
                Ok(_) => {
                    println!("  OK {} -> {}", like.uri, new_uri);
                    total_migrated += 1;
                }
                Err(e) => {
                    eprintln!("  FAIL update DB for {}: {e}", like.uri);
                    total_failed += 1;
                }
            }
        }
    }

    println!("\n=== Migration complete ===");
    println!("  Migrated: {total_migrated}");
    println!("  Skipped (no session): {total_skipped}");
    println!("  Failed: {total_failed}");
}
