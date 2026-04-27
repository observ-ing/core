use serde::{Deserialize, Serialize};

use crate::did::Did;

/// AT Protocol profile
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub did: String,
    pub handle: String,
    pub display_name: Option<String>,
    pub avatar: Option<String>,
}

/// Result of resolving a handle or DID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveResult {
    pub did: Did,
    pub handle: Option<String>,
    pub pds_endpoint: Option<String>,
}

/// DID Document
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DidDocument {
    #[allow(dead_code)]
    pub(crate) id: String,
    pub(crate) also_known_as: Option<Vec<String>>,
    pub(crate) service: Option<Vec<DidService>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DidService {
    pub(crate) id: String,
    #[allow(dead_code)]
    pub(crate) r#type: String,
    pub(crate) service_endpoint: String,
}

/// Bluesky API response types
#[derive(Debug, Deserialize)]
pub(crate) struct ResolveHandleResponse {
    pub(crate) did: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileResponse {
    pub(crate) did: String,
    pub(crate) handle: String,
    pub(crate) display_name: Option<String>,
    pub(crate) avatar: Option<String>,
}

impl From<ProfileResponse> for Profile {
    fn from(resp: ProfileResponse) -> Self {
        Self {
            did: resp.did,
            handle: resp.handle,
            display_name: resp.display_name,
            avatar: resp.avatar,
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct ProfilesResponse {
    pub(crate) profiles: Vec<ProfileResponse>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchActorsTypeaheadResponse {
    pub(crate) actors: Vec<ProfileResponse>,
}
