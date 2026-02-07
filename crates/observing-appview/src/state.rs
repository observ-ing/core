use observing_geocoding::GeocodingService;
use observing_identity::IdentityResolver;
use sqlx::postgres::PgPool;
use std::sync::Arc;

use crate::atproto::InternalAgentClient;
use crate::taxonomy_client::TaxonomyClient;

/// Shared application state passed to all route handlers
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub resolver: Arc<IdentityResolver>,
    pub taxonomy: Arc<TaxonomyClient>,
    pub geocoding: Arc<GeocodingService>,
    pub agent: Arc<InternalAgentClient>,
    pub media_proxy_url: String,
}
