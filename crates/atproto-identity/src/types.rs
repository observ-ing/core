use serde::{Deserialize, Serialize};

/// AT Protocol profile
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub did: String,
    pub handle: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub followers_count: Option<u64>,
    pub follows_count: Option<u64>,
    pub posts_count: Option<u64>,
}

/// Result of resolving a handle or DID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveResult {
    pub did: String,
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
    pub(crate) description: Option<String>,
    pub(crate) avatar: Option<String>,
    pub(crate) banner: Option<String>,
    pub(crate) followers_count: Option<u64>,
    pub(crate) follows_count: Option<u64>,
    pub(crate) posts_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ProfilesResponse {
    pub(crate) profiles: Vec<ProfileResponse>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct FollowsResponse {
    pub(crate) follows: Vec<FollowEntry>,
    pub(crate) cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct FollowEntry {
    pub(crate) did: String,
}
