//! Cross-posting occurrences to iNaturalist (#878).
//!
//! An occurrence is pushed once, at its owner's request. Nothing is pulled
//! back, and later edits here are not pushed.

pub mod client;
pub mod guard;
pub mod ids;
pub mod links;
pub mod payload;
pub mod worker;

use std::time::Duration;

use inaturalist_oauth::{Authenticator, AuthorizationInfo, PkceVerifier, TokenDetails};
use moka::future::Cache;
use tokio::sync::Notify;

use crate::config::InatConfig;
use client::{InatClient, InatError};

/// This destination's `service`, in `linked_accounts`, `crossposts`, and the
/// lexicon's `externalRecords`.
pub const SERVICE: &str = "inaturalist";

/// iNaturalist asks applications to stay at or under 60 requests a minute.
const MIN_CALL_INTERVAL: Duration = Duration::from_secs(1);

/// An API token lasts 24 hours; replace ours well before that.
const API_TOKEN_TTL: Duration = Duration::from_secs(12 * 60 * 60);

/// Everything cross-posting to iNaturalist needs at runtime. Present in
/// [`crate::state::AppState`] only when an iNaturalist application is configured.
pub struct Inat {
    pub client: InatClient,
    config: InatConfig,
    redirect_uri: String,
    /// API tokens by DID, so a job doesn't mint one per call.
    api_tokens: Cache<String, String>,
    /// Wakes the worker when a cross-post is queued.
    wake: Notify,
}

impl Inat {
    pub fn new(config: InatConfig, public_url: Option<&str>, port: u16) -> Self {
        Self {
            client: InatClient::new(config.api_url.clone(), MIN_CALL_INTERVAL),
            redirect_uri: redirect_uri(public_url, port),
            config,
            api_tokens: Cache::builder().time_to_live(API_TOKEN_TTL).build(),
            wake: Notify::new(),
        }
    }

    /// Base of observation permalinks.
    pub fn site_url(&self) -> &str {
        &self.config.site_url
    }

    fn authenticator(&self) -> Authenticator {
        Authenticator::new(
            self.config.client_id.clone(),
            self.config.client_secret.clone(),
        )
        .with_redirect_uri(self.redirect_uri.clone())
    }

    /// Where to send a user to authorize observ.ing, with the `state` and PKCE
    /// verifier to hold on to until they come back.
    pub fn authorization_url(&self) -> Result<AuthorizationInfo, InatError> {
        self.authenticator().authorization_url().map_err(|e| {
            InatError(format!(
                "Could not build the iNaturalist authorize URL: {e}"
            ))
        })
    }

    /// Finish authorization with the `code` iNaturalist redirected back with.
    pub async fn exchange_code(
        &self,
        code: String,
        pkce_verifier: PkceVerifier,
    ) -> Result<TokenDetails, InatError> {
        self.authenticator()
            .exchange_code(oauth2::AuthorizationCode::new(code), pkce_verifier)
            .await
            .map_err(|e| InatError(format!("iNaturalist authorization failed: {e}")))
    }

    /// An API token for the user, minted from their OAuth access token unless
    /// a recent one is cached.
    pub async fn api_token(&self, did: &str, access_token: &str) -> Result<String, InatError> {
        if let Some(token) = self.api_tokens.get(did).await {
            return Ok(token);
        }
        let details = inaturalist_oauth::api_token(access_token)
            .await
            .map_err(|e| InatError(format!("Could not get an iNaturalist API token: {e}")))?;
        self.remember_api_token(did, &details.api_token).await;
        Ok(details.api_token)
    }

    pub async fn remember_api_token(&self, did: &str, api_token: &str) {
        self.api_tokens
            .insert(did.to_string(), api_token.to_string())
            .await;
    }

    pub async fn forget_api_token(&self, did: &str) {
        self.api_tokens.invalidate(did).await;
    }

    /// Tell the worker there is a cross-post to do.
    pub fn wake_worker(&self) {
        self.wake.notify_one();
    }

    async fn woken(&self) {
        self.wake.notified().await;
    }
}

/// Where iNaturalist sends the user back to. Must be registered on the
/// iNaturalist application; mirrors how the AT Protocol OAuth callback is built.
fn redirect_uri(public_url: Option<&str>, port: u16) -> String {
    match public_url {
        Some(public_url) => format!("{}/api/inat/callback", public_url.trim_end_matches('/')),
        None => format!("http://127.0.0.1:{port}/api/inat/callback"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirects_to_the_public_url_in_production() {
        assert_eq!(
            redirect_uri(Some("https://observ.ing"), 3004),
            "https://observ.ing/api/inat/callback"
        );
        assert_eq!(
            redirect_uri(Some("https://observ.ing/"), 3004),
            "https://observ.ing/api/inat/callback"
        );
    }

    #[test]
    fn redirects_to_the_loopback_address_in_development() {
        assert_eq!(
            redirect_uri(None, 3004),
            "http://127.0.0.1:3004/api/inat/callback"
        );
    }
}
