mod auth;
mod config;
mod constants;
mod enrichment;
mod error;
mod media;
mod middleware;
mod oauth_store;
mod resolver;
mod responses;
mod routes;
mod species_id_client;
mod state;
mod taxonomy;
mod taxonomy_client;
mod validation;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::http::{header, Method};
use axum::middleware as axum_middleware;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

use config::Config;
use species_id_client::SpeciesIdClient;
use state::AppState;
use taxonomy_client::TaxonomyClient;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "observing_appview=info".into()),
        )
        .json()
        .init();

    let config = Config::from_env();
    info!(port = config.port, "Starting observing-appview");

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(50)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Some(Duration::from_secs(300)))
        .max_lifetime(Some(Duration::from_secs(1800)))
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    // Create OAuth client
    let oauth_client =
        state::create_oauth_client(pool.clone(), config.public_url.as_deref(), config.port);

    let species_id = config
        .species_id_service_url
        .as_deref()
        .map(|url| Arc::new(SpeciesIdClient::new(url)));

    let media = media::MediaCache::from_env().await;

    let state = AppState {
        pool,
        resolver: Arc::new(atproto_identity::IdentityResolver::new()),
        taxonomy: Arc::new(TaxonomyClient::new()),
        species_id,
        oauth_client: Arc::new(oauth_client),
        media,
        public_url: config.public_url.clone(),
        hidden_dids: config.hidden_dids.clone(),
        admin_dids: config.admin_dids.clone(),
    };

    // CORS
    let cors = if config.cors_origins.iter().any(|o| o == "*") {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins: Vec<_> = config
            .cors_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
            .allow_headers([header::CONTENT_TYPE, header::COOKIE, header::AUTHORIZATION])
            .allow_credentials(true)
    };

    let app = Router::new()
        // Health
        .route("/health", get(routes::health::health))
        // OAuth
        .route(
            "/oauth/client-metadata.json",
            get(routes::oauth::client_metadata),
        )
        .route("/oauth/login", get(routes::oauth::login))
        .route("/oauth/callback", get(routes::oauth::callback))
        .route("/oauth/logout", post(routes::oauth::logout))
        .route("/oauth/me", get(routes::oauth::me))
        // Occurrences - specific routes before wildcard
        .route(
            "/api/occurrences/nearby",
            get(routes::occurrences::get_nearby),
        )
        .route("/api/occurrences/feed", get(routes::occurrences::get_feed))
        .route("/api/occurrences/bbox", get(routes::occurrences::get_bbox))
        .route(
            "/api/occurrences/geojson",
            get(routes::occurrences::get_geojson),
        )
        .route(
            "/api/occurrences/{*uri}",
            get(routes::occurrences::get_occurrence).delete(routes::occurrences::delete_occurrence),
        )
        // Occurrences write (no wildcard)
        .route(
            "/api/occurrences",
            post(routes::occurrences::create_occurrence)
                .put(routes::occurrences::update_occurrence),
        )
        // Feeds
        .route("/api/feeds/explore", get(routes::feeds::get_explore))
        .route("/api/feeds/home", get(routes::feeds::get_home))
        // Profiles
        .route(
            "/api/profiles/{did}/feed",
            get(routes::profiles::get_profile_feed),
        )
        // Identifications
        .route(
            "/api/identifications",
            post(routes::identifications::create_identification),
        )
        .route(
            "/api/identifications/{*uri}",
            get(routes::identifications::get_for_occurrence)
                .delete(routes::identifications::delete_identification),
        )
        // Comments
        .route("/api/comments", post(routes::comments::create_comment))
        // Likes
        .route(
            "/api/likes",
            post(routes::likes::create_like).delete(routes::likes::delete_like),
        )
        // Interactions
        .route(
            "/api/interactions",
            post(routes::interactions::create_interaction),
        )
        .route(
            "/api/interactions/occurrence/{*uri}",
            get(routes::interactions::get_for_occurrence),
        )
        // Notifications
        .route("/api/notifications", get(routes::notifications::list))
        .route(
            "/api/notifications/unread-count",
            get(routes::notifications::unread_count),
        )
        .route(
            "/api/notifications/read",
            post(routes::notifications::mark_read),
        )
        // Actors
        // Species identification
        .route("/api/species-id", post(routes::species_id::identify))
        // Taxonomy
        .route("/api/taxa/search", get(routes::taxonomy::search))
        .route("/api/taxa/validate", get(routes::taxonomy::validate))
        .route(
            "/api/taxa/{kingdom}/{name}",
            get(routes::taxonomy::get_taxon_by_kingdom_name),
        )
        .route(
            "/api/taxa/{kingdom}/{name}/children",
            get(routes::taxonomy::get_children_by_kingdom_name),
        )
        .route(
            "/api/taxa/{kingdom}/{name}/occurrences",
            get(routes::taxonomy::get_taxon_occurrences_by_kingdom_name),
        )
        .route("/api/taxa/{id}", get(routes::taxonomy::get_taxon_by_id))
        .route(
            "/api/taxa/{id}/occurrences",
            get(routes::taxonomy::get_taxon_occurrences_by_id),
        )
        // Admin (lexicon-scoped record management)
        .route("/admin/collections", get(routes::admin::list_collections))
        .route(
            "/admin/collections/{nsid}",
            get(routes::admin::get_collection),
        )
        .route(
            "/admin/collections/{nsid}/records",
            get(routes::admin::list_records),
        )
        .route("/admin/tables", get(routes::admin::list_tables))
        .route(
            "/admin/tables/{name}/rows",
            get(routes::admin::list_table_rows),
        )
        // Media (blob/thumb cache, formerly observing-media-proxy)
        .route("/media/health", get(routes::media::health))
        .route("/media/blob/{did}/{cid}", get(routes::media::get_blob))
        .route("/media/thumb/{did}/{cid}", get(routes::media::get_thumb))
        .layer(DefaultBodyLimit::max(150 * 1024 * 1024)) // 150MB for base64-encoded images
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(axum_middleware::map_response({
            let is_production = config.public_url.is_some();
            move |response| middleware::security_headers(response, is_production)
        }))
        .with_state(state);

    // Serve the frontend: use pre-built static files if available, otherwise proxy to Vite
    let built_public = std::env::var("PUBLIC_PATH")
        .map(PathBuf::from)
        .ok()
        .or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../dist/public")
                .canonicalize()
                .ok()
        });

    let app = match built_public {
        Some(path) => {
            info!(path = %path.display(), "Serving pre-built frontend");
            let fallback = ServeDir::new(&path).fallback(ServeFile::new(path.join("index.html")));
            app.fallback_service(fallback)
                .layer(axum_middleware::from_fn(middleware::static_cache_control))
        }
        None => {
            let vite_url = "http://localhost:5173";
            info!(
                vite_url,
                "No pre-built frontend found, proxying to Vite dev server"
            );
            let client = reqwest::Client::new();
            app.fallback(move |req: axum::extract::Request| {
                let client = client.clone();
                async move { vite_proxy(req, vite_url, &client).await }
            })
        }
    };

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .expect("Failed to bind");

    info!(port = config.port, "Listening");

    axum::serve(listener, app).await.expect("Server failed");
}

async fn vite_proxy(
    req: axum::extract::Request,
    vite_base_url: &str,
    client: &reqwest::Client,
) -> axum::response::Response {
    let path_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
    let target_url = format!("{}{}", vite_base_url, path_query);

    let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);

    let mut builder = client.request(method, &target_url);
    for (name, value) in req.headers() {
        if name != axum::http::header::HOST {
            builder = builder.header(name, value);
        }
    }

    let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
        .await
        .unwrap_or_default();
    if !body_bytes.is_empty() {
        builder = builder.body(body_bytes);
    }

    match builder.send().await {
        Ok(upstream) => {
            let status = axum::http::StatusCode::from_u16(upstream.status().as_u16())
                .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
            let mut response = axum::http::Response::builder().status(status);
            for (name, value) in upstream.headers() {
                response = response.header(name, value);
            }
            let bytes = upstream.bytes().await.unwrap_or_default();
            response
                .body(axum::body::Body::from(bytes))
                .unwrap_or_else(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                vite_url = vite_base_url,
                "Failed to proxy request to Vite dev server — is it running?"
            );
            axum::http::StatusCode::BAD_GATEWAY.into_response()
        }
    }
}
