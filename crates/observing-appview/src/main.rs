mod auth;
mod config;
mod enrichment;
mod error;
mod oauth_store;
mod resolver;
mod routes;
mod state;
mod taxonomy_client;

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::http::{header, Method};
use axum::routing::{get, post};
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

use config::Config;
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
        .max_connections(20)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    // Create OAuth client
    let oauth_client =
        state::create_oauth_client(pool.clone(), config.public_url.as_deref(), config.port);

    let state = AppState {
        pool,
        resolver: Arc::new(atproto_identity::IdentityResolver::new()),
        taxonomy: Arc::new(TaxonomyClient::new(&config.taxonomy_service_url)),
        geocoding: Arc::new(nominatim_client::NominatimClient::new()),
        oauth_client: Arc::new(oauth_client),
        media_proxy_url: config.media_proxy_url.clone(),
        public_url: config.public_url.clone(),
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
            get(routes::occurrences::get_occurrence_or_observers)
                .post(routes::occurrences::post_occurrence_catch_all)
                .delete(routes::occurrences::delete_occurrence_catch_all),
        )
        // Occurrences write (no wildcard)
        .route(
            "/api/occurrences",
            post(routes::occurrences::create_occurrence),
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
        // Taxonomy
        .route("/api/taxa/search", get(routes::taxonomy::search))
        .route("/api/taxa/validate", get(routes::taxonomy::validate))
        .route(
            "/api/taxa/{kingdom}/{name}",
            get(routes::taxonomy::get_taxon_by_kingdom_name),
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
        // Media proxy
        .route("/media/{*path}", get(routes::media::proxy))
        .layer(DefaultBodyLimit::max(150 * 1024 * 1024)) // 150MB for base64-encoded images
        .layer(cors)
        .with_state(state);

    // Serve React SPA with fallback to index.html for client-side routing
    let public_path = std::env::var("PUBLIC_PATH").unwrap_or_else(|_| {
        // Default: dist/public relative to the workspace root
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .join("../../dist/public")
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "dist/public".to_string())
    });

    info!(public_path = %public_path, "Serving static files");

    let spa_fallback =
        ServeDir::new(&public_path).fallback(ServeFile::new(format!("{}/index.html", public_path)));

    let app = app.fallback_service(spa_fallback);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .expect("Failed to bind");

    info!(port = config.port, "Listening");

    axum::serve(listener, app).await.expect("Server failed");
}
