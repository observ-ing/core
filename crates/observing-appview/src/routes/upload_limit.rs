//! The largest photo the viewer can attach to an occurrence, so the upload
//! form can state it and refuse a photo when it's picked rather than after a
//! failed submit.
//!
//! That's the media lexicon's cap, unless the viewer's PDS advertises a lower
//! blob upload limit through `com.atproto.server.describeServer`.

use std::time::Duration;

use atrium_api::com::atproto::server::describe_server;
use axum::extract::State;
use axum::Json;
use moka::future::Cache;
use serde::Serialize;
use tracing::warn;
use ts_rs::TS;
use utoipa::ToSchema;

use crate::auth::{self, AuthUser};
use crate::constants;
use crate::error::{AppError, ErrorResponse};
use crate::state::AppState;

/// How long a PDS's advertised limit is trusted before it's read again.
const PDS_UPLOAD_LIMIT_TTL: Duration = Duration::from_secs(60 * 60);

/// Each viewer's PDS-advertised blob upload limit, keyed by DID. `None` means
/// their PDS doesn't advertise one.
pub type PdsUploadLimits = Cache<String, Option<u64>>;

pub fn new_pds_upload_limits() -> PdsUploadLimits {
    Cache::builder()
        .time_to_live(PDS_UPLOAD_LIMIT_TTL)
        .max_capacity(10_000)
        .build()
}

#[derive(Debug, PartialEq, Serialize, TS, ToSchema)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct UploadLimitResponse {
    /// Largest photo, in bytes, the viewer can attach.
    pub max_image_bytes: u32,
    /// True when `maxImageBytes` is the viewer's PDS's own limit, lower than
    /// the media lexicon's.
    pub limited_by_pds: bool,
}

/// Get the largest photo the viewer can attach.
///
/// Falls back to the media lexicon's cap when the viewer's PDS doesn't
/// advertise a limit or can't be reached.
#[utoipa::path(
    get,
    path = "/api/user/upload-limit",
    tag = "media",
    security(("session" = [])),
    responses(
        (status = 200, description = "The viewer's per-photo upload limit", body = UploadLimitResponse),
        (status = 401, description = "Not signed in", body = ErrorResponse),
    )
)]
pub async fn get_upload_limit(
    State(state): State<AppState>,
    user: AuthUser,
) -> Json<UploadLimitResponse> {
    let pds_limit = state
        .pds_upload_limits
        .try_get_with(user.did.clone(), fetch_pds_upload_limit(&state, &user.did))
        .await
        .unwrap_or_else(|e| {
            warn!(error = ?e, did = %user.did, "Could not read the PDS's upload limit");
            None
        });
    Json(effective_upload_limit(pds_limit))
}

async fn fetch_pds_upload_limit(state: &AppState, did: &str) -> Result<Option<u64>, AppError> {
    let (agent, _) = auth::require_agent(&state.oauth_client, did).await?;
    let output = agent
        .api
        .com
        .atproto
        .server
        .describe_server()
        .await
        .map_err(|e| AppError::Internal(format!("describeServer failed: {e}")))?;
    Ok(blob_upload_limit(&output))
}

/// The `blobUploadLimit` a describeServer response advertises, if any. The
/// field postdates atrium's generated type, so it's read from the fields that
/// type doesn't know about.
fn blob_upload_limit(output: &describe_server::Output) -> Option<u64> {
    serde_json::to_value(&output.extra_data)
        .ok()?
        .get("blobUploadLimit")?
        .as_u64()
}

fn effective_upload_limit(pds_limit: Option<u64>) -> UploadLimitResponse {
    let lexicon_cap = constants::MAX_IMAGE_BYTES as u32;
    match pds_limit {
        Some(limit) if limit < u64::from(lexicon_cap) => UploadLimitResponse {
            max_image_bytes: limit as u32,
            limited_by_pds: true,
        },
        _ => UploadLimitResponse {
            max_image_bytes: lexicon_cap,
            limited_by_pds: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn describe_server(json: &str) -> describe_server::Output {
        serde_json::from_str(json).expect("valid describeServer response")
    }

    /// Read off a real response shape, as atrium deserializes it.
    #[test]
    fn reads_an_advertised_limit() {
        let output = describe_server(
            r#"{"did":"did:web:puffball.us-east.host.bsky.network",
                "availableUserDomains":[".bsky.social"],
                "inviteCodeRequired":true,
                "blobUploadLimit":314572800}"#,
        );
        assert_eq!(blob_upload_limit(&output), Some(314_572_800));
    }

    /// PDSes older than the field, or other implementations, leave it out.
    #[test]
    fn a_pds_without_the_field_advertises_nothing() {
        let output = describe_server(r#"{"did":"did:web:pds.example","availableUserDomains":[]}"#);
        assert_eq!(blob_upload_limit(&output), None);
    }

    #[test]
    fn a_limit_above_the_lexicon_cap_leaves_the_cap() {
        assert_eq!(
            effective_upload_limit(Some(314_572_800)),
            UploadLimitResponse {
                max_image_bytes: 10_000_000,
                limited_by_pds: false,
            }
        );
    }

    #[test]
    fn a_limit_below_the_lexicon_cap_wins() {
        assert_eq!(
            effective_upload_limit(Some(5_242_880)),
            UploadLimitResponse {
                max_image_bytes: 5_242_880,
                limited_by_pds: true,
            }
        );
    }

    #[test]
    fn no_advertised_limit_leaves_the_cap() {
        assert_eq!(
            effective_upload_limit(None),
            UploadLimitResponse {
                max_image_bytes: 10_000_000,
                limited_by_pds: false,
            }
        );
    }
}
