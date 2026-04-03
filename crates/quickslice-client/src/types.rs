//! Types representing QuickSlice GraphQL response shapes.
//!
//! These map to the auto-generated GraphQL schema from the observ-ing lexicons.
//! Field names use camelCase to match the GraphQL schema directly.

use serde::Deserialize;

/// Relay-style connection wrapper.
#[derive(Debug, Clone, Deserialize)]
pub struct Connection<T> {
    pub edges: Vec<Edge<T>>,
    #[serde(rename = "totalCount")]
    pub total_count: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Edge<T> {
    pub node: T,
    pub cursor: Option<String>,
}

impl<T> Connection<T> {
    pub fn nodes(self) -> Vec<T> {
        self.edges.into_iter().map(|e| e.node).collect()
    }

    pub fn last_cursor(&self) -> Option<&str> {
        self.edges.last().and_then(|e| e.cursor.as_deref())
    }
}

/// Occurrence record from QuickSlice.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub actor_handle: Option<String>,
    pub indexed_at: Option<String>,
    pub event_date: Option<String>,
    pub created_at: Option<String>,
    pub location: Option<OccurrenceLocation>,
    pub verbatim_locality: Option<String>,
    pub notes: Option<String>,
    pub license: Option<String>,
    pub blobs: Option<Vec<ImageEmbed>>,
    pub recorded_by: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceLocation {
    pub decimal_latitude: Option<String>,
    pub decimal_longitude: Option<String>,
    pub coordinate_uncertainty_in_meters: Option<i32>,
    pub geodetic_datum: Option<String>,
    pub continent: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub state_province: Option<String>,
    pub county: Option<String>,
    pub municipality: Option<String>,
    pub locality: Option<String>,
    pub water_body: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEmbed {
    pub image: Option<serde_json::Value>,
    pub alt: Option<String>,
    pub aspect_ratio: Option<AspectRatio>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AspectRatio {
    pub width: Option<i32>,
    pub height: Option<i32>,
}

/// Identification record from QuickSlice.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identification {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub actor_handle: Option<String>,
    pub subject_index: Option<i32>,
    pub taxon: Option<Taxon>,
    pub taxon_id: Option<String>,
    pub comment: Option<String>,
    pub is_agreement: Option<bool>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Taxon {
    pub scientific_name: Option<String>,
    pub scientific_name_authorship: Option<String>,
    pub taxon_rank: Option<String>,
    pub vernacular_name: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
}

/// Comment record from QuickSlice.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub actor_handle: Option<String>,
    pub body: Option<String>,
    pub created_at: Option<String>,
}

/// Like record from QuickSlice.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Like {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub created_at: Option<String>,
}

/// Interaction record from QuickSlice.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interaction {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub actor_handle: Option<String>,
    pub subject_a: Option<InteractionSubject>,
    pub subject_b: Option<InteractionSubject>,
    pub interaction_type: Option<String>,
    pub direction: Option<String>,
    pub comment: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSubject {
    pub occurrence: Option<serde_json::Value>,
    pub subject_index: Option<i32>,
    pub taxon: Option<Taxon>,
}

/// Wrapper for occurrence with inline joins (identifications, likes, comments).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceWithJoins {
    #[serde(flatten)]
    pub occurrence: Occurrence,
    #[serde(
        rename = "orgRwellTestIdentificationViaSubject",
        default
    )]
    pub identifications: Option<Connection<Identification>>,
    #[serde(rename = "orgRwellTestLikeViaSubject", default)]
    pub likes: Option<Connection<Like>>,
    #[serde(rename = "orgRwellTestCommentViaSubject", default)]
    pub comments: Option<Connection<Comment>>,
    #[serde(
        rename = "viewerOrgRwellTestLikeViaSubject",
        default
    )]
    pub viewer_like: Option<Like>,
}

/// Aggregation result.
#[derive(Debug, Clone, Deserialize)]
pub struct AggregatedResult {
    pub did: Option<String>,
    pub count: Option<i64>,
}
