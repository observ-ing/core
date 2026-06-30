use atproto_identity::IdentityResolver;
use sqlx::postgres::PgPool;
use std::sync::Arc;

use crate::media::MediaCache;
use crate::oauth_store::{PgSessionStore, PgStateStore};
use crate::resolver::HickoryDnsTxtResolver;
use crate::species_id_client::SpeciesIdClient;
use crate::taxonomy_client::TaxonomyClient;

use atrium_api::types::string::{Did, Handle};
use atrium_common::resolver::Resolver;
use atrium_identity::did::{CommonDidResolver, CommonDidResolverConfig};
use atrium_identity::handle::{
    AppViewHandleResolver, AppViewHandleResolverConfig, AtprotoHandleResolver,
    AtprotoHandleResolverConfig, HandleResolver,
};
use atrium_oauth::{DefaultHttpClient, OAuthClient};

/// Handle→DID resolver chosen at startup.
///
/// Production uses the spec-default decentralized resolver (DNS TXT +
/// `.well-known`). Setting `HANDLE_RESOLVER_URL` switches to an AppView-style
/// `com.atproto.identity.resolveHandle` call against that URL — this is how the
/// stack is pointed at a local `@atproto/dev-env` PDS for isolated e2e, where
/// `.test` handles cannot resolve via DNS.
pub enum AppHandleResolver {
    // Boxed: the DNS resolver is ~10x larger than the AppView variant
    // (clippy::large_enum_variant).
    Dns(Box<AtprotoHandleResolver<HickoryDnsTxtResolver, DefaultHttpClient>>),
    AppView(AppViewHandleResolver<DefaultHttpClient>),
}

impl Resolver for AppHandleResolver {
    type Input = Handle;
    type Output = Did;
    type Error = atrium_identity::Error;

    async fn resolve(&self, handle: &Handle) -> Result<Did, atrium_identity::Error> {
        match self {
            Self::Dns(r) => r.resolve(handle).await,
            Self::AppView(r) => r.resolve(handle).await,
        }
    }
}

impl HandleResolver for AppHandleResolver {}

/// Build the handle resolver from `HANDLE_RESOLVER_URL` (AppView-style when set,
/// decentralized DNS/well-known otherwise).
fn build_handle_resolver(http_client: Arc<DefaultHttpClient>) -> AppHandleResolver {
    match std::env::var("HANDLE_RESOLVER_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(service_url) => {
            AppHandleResolver::AppView(AppViewHandleResolver::new(AppViewHandleResolverConfig {
                service_url,
                http_client,
            }))
        }
        None => AppHandleResolver::Dns(Box::new(AtprotoHandleResolver::new(
            AtprotoHandleResolverConfig {
                dns_txt_resolver: HickoryDnsTxtResolver::default(),
                http_client,
            },
        ))),
    }
}

/// The concrete OAuthClient type with PostgreSQL stores and DNS resolution.
pub type OAuthClientType = OAuthClient<
    PgStateStore,
    PgSessionStore,
    CommonDidResolver<DefaultHttpClient>,
    AppHandleResolver,
>;

/// The concrete OAuth session type returned by `OAuthClientType::restore()`.
pub type OAuthSessionType = atrium_oauth::OAuthSession<
    DefaultHttpClient,
    CommonDidResolver<DefaultHttpClient>,
    AppHandleResolver,
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
    pub species_id: Option<Arc<SpeciesIdClient>>,
    /// Faster ViT-L service for the live camera loop. `None` falls back to
    /// `species_id` so single-service deployments (e.g. local dev) still work.
    pub species_id_live: Option<Arc<SpeciesIdClient>>,
    pub oauth_client: Arc<OAuthClientType>,
    /// In-process AT Protocol blob cache + PDS fetcher (formerly the
    /// `observing-media-proxy` service).
    pub media: Arc<MediaCache>,
    pub public_url: Option<String>,
    /// DIDs to hide from all feeds (e.g. test accounts)
    pub hidden_dids: Vec<String>,
    /// DIDs allowed to access admin routes. When empty, admin routes return 503.
    pub admin_dids: Vec<String>,
    /// Base URL of the tap-ingester service, if configured. Enables the
    /// HTTP-backed `ingester/*` tables in the admin browser.
    pub ingester_url: Option<String>,
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
            plc_directory_url: atproto_identity::plc_directory_url(),
            http_client: http_client.clone(),
        }),
        handle_resolver: build_handle_resolver(http_client.clone()),
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
