mod config;
mod enrichment;
mod error;
mod routes;
mod state;
mod taxonomy_client;

use std::sync::Arc;

use axum::routing::get;
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use axum::http::{header, Method};
use tower_http::cors::{Any, CorsLayer};
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

    let state = AppState {
        pool,
        resolver: Arc::new(observing_identity::IdentityResolver::new()),
        taxonomy: Arc::new(TaxonomyClient::new(&config.taxonomy_service_url)),
        media_proxy_url: config.media_proxy_url.clone(),
    };

    // CORS
    let cors = if config
        .cors_origins
        .iter()
        .any(|o| o == "*")
    {
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
        // Occurrences - specific routes before wildcard
        .route("/api/occurrences/nearby", get(routes::occurrences::get_nearby))
        .route("/api/occurrences/feed", get(routes::occurrences::get_feed))
        .route("/api/occurrences/bbox", get(routes::occurrences::get_bbox))
        .route(
            "/api/occurrences/geojson",
            get(routes::occurrences::get_geojson),
        )
        .route(
            "/api/occurrences/{*uri}",
            get(routes::occurrences::get_occurrence_or_observers),
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
            "/api/identifications/{*occurrence_uri}",
            get(routes::identifications::get_for_occurrence),
        )
        // Interactions
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
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .expect("Failed to bind");

    info!(port = config.port, "Listening");

    axum::serve(listener, app).await.expect("Server failed");
}
