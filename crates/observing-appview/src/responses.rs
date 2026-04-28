use serde::Serialize;
use ts_rs::TS;

use crate::enrichment::{
    EnrichedComment, EnrichedIdentification, EnrichedInteraction, OccurrenceResponse,
    ProfileSummary,
};
use crate::taxonomy_client::TaxonResult;

/// Response returned when an AT Protocol record is created.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct RecordCreatedResponse {
    pub success: bool,
    pub uri: String,
    pub cid: String,
}

/// Simple success/failure response with no additional payload.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct SuccessResponse {
    pub success: bool,
}

// --- Feed responses ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceListResponse {
    pub occurrences: Vec<OccurrenceResponse>,
    pub cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreFilters {
    pub taxon: Option<String>,
    pub kingdom: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius: Option<f64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreMeta {
    pub filters: ExploreFilters,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreFeedResponse {
    pub occurrences: Vec<OccurrenceResponse>,
    pub cursor: Option<String>,
    pub meta: ExploreMeta,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeFeedResponse {
    pub occurrences: Vec<OccurrenceResponse>,
    pub cursor: Option<String>,
}

// --- Occurrence responses ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyMeta {
    pub lat: f64,
    pub lng: f64,
    pub radius: f64,
    pub limit: i64,
    pub offset: i64,
    pub count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyResponse {
    pub occurrences: Vec<OccurrenceResponse>,
    pub meta: NearbyMeta,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BboxBounds {
    pub min_lat: f64,
    pub min_lng: f64,
    pub max_lat: f64,
    pub max_lng: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BboxMeta {
    pub bounds: BboxBounds,
    pub count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BboxResponse {
    pub occurrences: Vec<OccurrenceResponse>,
    pub meta: BboxMeta,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoJsonFeature {
    #[serde(rename = "type")]
    pub feature_type: &'static str,
    pub geometry: GeoJsonPoint,
    pub properties: GeoJsonProperties,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoJsonPoint {
    #[serde(rename = "type")]
    pub geometry_type: &'static str,
    pub coordinates: [f64; 2],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoJsonProperties {
    pub uri: String,
    pub event_date: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoJsonResponse {
    #[serde(rename = "type")]
    pub collection_type: &'static str,
    pub features: Vec<GeoJsonFeature>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceDetailResponse {
    pub occurrence: OccurrenceResponse,
    pub identifications: Vec<EnrichedIdentification>,
    pub comments: Vec<EnrichedComment>,
}

// --- Notification responses ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadCountResponse {
    pub count: i64,
}

// --- Identification responses ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentificationListResponse {
    pub identifications: Vec<EnrichedIdentification>,
    pub community_id: Option<String>,
}

// --- Interaction responses ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionListResponse {
    pub interactions: Vec<EnrichedInteraction>,
}

// --- Taxonomy responses ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonSearchResponse {
    pub results: Vec<TaxonResult>,
}

// --- Profile responses ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCounts {
    pub observations: i64,
    pub identifications: i64,
    pub species: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFeedResponse {
    pub profile: ProfileSummary,
    pub counts: ProfileCounts,
    pub occurrences: Vec<OccurrenceResponse>,
    pub identifications: Vec<EnrichedIdentification>,
    pub cursor: Option<String>,
}
