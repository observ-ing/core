//! AI bot account agent.
//!
//! Authenticates a single Bluesky service account via AT Protocol app
//! password and exposes a thin `create_record` helper so other modules can
//! post records authored by the bot. When the `AI_BLUESKY_*` env vars are
//! unset the agent is `None` and AI-authored identifications are skipped.

use std::sync::Arc;

use atrium_api::agent::atp_agent::store::MemorySessionStore;
use atrium_api::agent::atp_agent::CredentialSession;
use atrium_api::agent::Agent;
use atrium_xrpc_client::reqwest::ReqwestClient;
use serde_json::Value;

use crate::config::Config;
use crate::error::AppError;

/// Type alias for the bot's underlying session manager (CredentialSession +
/// reqwest XRPC client + in-memory session store).
type BotSessionManager = CredentialSession<MemorySessionStore, ReqwestClient>;

/// Bot account session capable of posting records under its own DID.
///
/// Atrium's inner client transparently refreshes the access JWT via
/// `com.atproto.server.refreshSession` on 401, so callers don't need to
/// manage token lifecycles.
pub struct AiAgent {
    agent: Agent<BotSessionManager>,
    did: atrium_api::types::string::Did,
}

impl AiAgent {
    /// Construct the bot agent from environment variables. Returns
    /// `Ok(None)` when any required env var is unset — callers should treat
    /// this as "AI auto-identification disabled".
    ///
    /// Performs a login round-trip; failure to authenticate is logged at
    /// warn but is not fatal to startup.
    pub async fn from_env(config: &Config) -> Option<Arc<Self>> {
        let handle = config.ai_bluesky_handle.clone()?;
        let password = config.ai_bluesky_app_password.clone()?;
        let expected_did = config.ai_bluesky_did.clone()?;

        let xrpc = ReqwestClient::new(config.ai_bluesky_pds_url.clone());
        let session = CredentialSession::new(xrpc, MemorySessionStore::default());

        match session.login(&handle, &password).await {
            Ok(result) => {
                let actual_did: &str = result.data.did.as_ref();
                if actual_did != expected_did {
                    tracing::warn!(
                        expected = %expected_did,
                        actual = %actual_did,
                        "AI bot login succeeded but returned DID does not match AI_BLUESKY_DID; refusing to enable AI auto-identification"
                    );
                    return None;
                }
                let did = result.data.did.clone();
                let agent = Agent::new(session);
                tracing::info!(handle = %handle, did = %actual_did, "AI agent ready");
                Some(Arc::new(Self { agent, did }))
            }
            Err(e) => {
                tracing::warn!(handle = %handle, error = %e, "AI bot login failed; disabling AI auto-identification");
                None
            }
        }
    }

    /// DID the bot posts under.
    pub fn did(&self) -> &atrium_api::types::string::Did {
        &self.did
    }

    /// Post a record to the bot's repo. Mirrors `auth::create_at_record` but
    /// uses the credential-session-backed agent.
    pub async fn create_record(
        &self,
        nsid: &str,
        record_value: Value,
    ) -> Result<atrium_api::com::atproto::repo::create_record::Output, AppError> {
        self.agent
            .api
            .com
            .atproto
            .repo
            .create_record(
                atrium_api::com::atproto::repo::create_record::InputData {
                    collection: nsid
                        .parse()
                        .map_err(|e| AppError::Internal(format!("Invalid NSID: {e}")))?,
                    record: serde_json::from_value(record_value).map_err(|e| {
                        AppError::Internal(format!("Failed to convert record: {e}"))
                    })?,
                    repo: atrium_api::types::string::AtIdentifier::Did(self.did.clone()),
                    rkey: None,
                    swap_commit: None,
                    validate: None,
                }
                .into(),
            )
            .await
            .map_err(|e| AppError::Internal(format!("AI bot failed to create record: {e}")))
    }
}
