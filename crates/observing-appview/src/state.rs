use atproto_identity::IdentityResolver;
use nominatim_client::NominatimClient;
use sqlx::postgres::PgPool;
use std::sync::Arc;

use crate::oauth_store::{PgSessionStore, PgStateStore};
use crate::resolver::HickoryDnsTxtResolver;
use crate::species_id_client::SpeciesIdClient;
use crate::taxonomy_client::TaxonomyClient;
use quickslice_client::QuickSliceClient;

use atrium_identity::did::{CommonDidResolver, CommonDidResolverConfig, DEFAULT_PLC_DIRECTORY_URL};
use atrium_identity::handle::{AtprotoHandleResolver, AtprotoHandleResolverConfig};
use atrium_oauth::{DefaultHttpClient, OAuthClient};

/// The concrete OAuthClient type with PostgreSQL stores and DNS resolution.
pub type OAuthClientType = OAuthClient<
    PgStateStore,
    PgSessionStore,
    CommonDidResolver<DefaultHttpClient>,
    AtprotoHandleResolver<HickoryDnsTxtResolver, DefaultHttpClient>,
>;

/// The concrete OAuth session type returned by `OAuthClientType::restore()`.
pub type OAuthSessionType = atrium_oauth::OAuthSession<
    DefaultHttpClient,
    CommonDidResolver<DefaultHttpClient>,
    AtprotoHandleResolver<HickoryDnsTxtResolver, DefaultHttpClient>,
    PgSessionStore,
>;

/// The concrete AT Protocol agent type used throughout the application.
pub type AgentType = atrium_api::agent::Agent<OAuthSessionType>;

/// Shared application state passed to all route handlers
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub resolver: Arc<IdentityResolver>,
    pub taxonomy: Arc<TaxonomyClient>,
    pub geocoding: Arc<NominatimClient>,
    pub species_id: Option<Arc<SpeciesIdClient>>,
    pub quickslice: Arc<QuickSliceClient>,
    pub oauth_client: Arc<OAuthClientType>,
    pub media_proxy_url: String,
    pub public_url: Option<String>,
    /// DIDs to hide from all feeds (e.g. test accounts)
    pub hidden_dids: Vec<String>,
}

/// Create an OAuthClient.
///
/// When `public_url` is provided (production), uses `AtprotoClientMetadata`
/// with the public URL for redirect URIs. Otherwise falls back to
/// `AtprotoLocalhostClientMetadata` for local development.
pub fn create_oauth_client(pool: PgPool, public_url: Option<&str>, port: u16) -> OAuthClientType {
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
            redirect_uris: Some(vec![format!("http://127.0.0.1:{port}/oauth/callback")]),
            scopes: Some(scopes),
        })
    }
}
