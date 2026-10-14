//! iNaturalist (#878). For now, linking a user's iNaturalist account over
//! OAuth; cross-posting occurrences to it builds on that.

pub mod client;

use std::time::Duration;

use inaturalist_oauth::{Authenticator, AuthorizationInfo, PkceVerifier, TokenDetails};

use crate::config::InatConfig;
use client::{InatClient, InatError};

/// This destination's `service`, in `linked_accounts`, `crossposts`, and the
/// lexicon's `externalRecords`.
pub const SERVICE: &str = "inaturalist";

/// iNaturalist asks applications to stay at or under 60 requests a minute.
const MIN_CALL_INTERVAL: Duration = Duration::from_secs(1);

/// How long to wait on iNaturalist before giving up on a request.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Everything talking to iNaturalist needs at runtime. Present in
/// [`crate::state::AppState`] only when an iNaturalist application is configured.
pub struct Inat {
    pub client: InatClient,
    config: InatConfig,
    redirect_uri: String,
}

impl Inat {
    pub fn new(config: InatConfig, public_url: Option<&str>, port: u16) -> Self {
        Self {
            client: InatClient::new(config.api_url.clone(), MIN_CALL_INTERVAL, REQUEST_TIMEOUT),
            redirect_uri: redirect_uri(public_url, port),
            config,
        }
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
            InatError::new(format!(
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
        let authenticator = self.authenticator();
        let exchange =
            authenticator.exchange_code(oauth2::AuthorizationCode::new(code), pkce_verifier);
        tokio::time::timeout(REQUEST_TIMEOUT, exchange)
            .await
            .map_err(|_| unanswered())?
            .map_err(|e| InatError::new(format!("iNaturalist authorization failed: {e}")))
    }
}

/// `inaturalist-oauth` sets no timeout of its own.
fn unanswered() -> InatError {
    InatError::new("iNaturalist did not respond")
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
