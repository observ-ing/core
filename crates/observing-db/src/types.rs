use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub enum ObserverRole {
    #[serde(rename = "owner")]
    Owner,
    #[serde(rename = "co-observer")]
    CoObserver,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub enum InteractionDirection {
    AtoB,
    BtoA,
    #[serde(rename = "bidirectional")]
    Bidirectional,
}

/// Occurrence row returned from SELECT queries
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OccurrenceRow {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub scientific_name: Option<String>,
    pub event_date: DateTime<Utc>,
    pub latitude: f64,
    pub longitude: f64,
    pub coordinate_uncertainty_meters: Option<i32>,
    // Darwin Core administrative geography
    pub continent: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub state_province: Option<String>,
    pub county: Option<String>,
    pub municipality: Option<String>,
    pub locality: Option<String>,
    pub water_body: Option<String>,
    pub verbatim_locality: Option<String>,
    pub occurrence_remarks: Option<String>,
    pub associated_media: Option<serde_json::Value>,
    pub recorded_by: Option<String>,
    pub taxon_id: Option<String>,
    pub taxon_rank: Option<String>,
    pub vernacular_name: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    #[sqlx(rename = "order")]
    #[serde(rename = "order")]
    pub order_: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Only present in nearby queries
    #[sqlx(default)]
    pub distance_meters: Option<f64>,
    /// Only present in home feed queries
    #[sqlx(default)]
    pub source: Option<String>,
    /// Only present in profile feed queries
    #[sqlx(default)]
    pub observer_role: Option<String>,
}

/// Identification row returned from SELECT queries
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
pub struct IdentificationRow {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub subject_uri: String,
    pub subject_cid: String,
    pub subject_index: i32,
    pub scientific_name: String,
    #[ts(optional)]
    pub taxon_rank: Option<String>,
    #[ts(optional)]
    pub identification_qualifier: Option<String>,
    #[ts(optional)]
    pub taxon_id: Option<String>,
    #[ts(optional)]
    pub identification_remarks: Option<String>,
    #[ts(optional)]
    pub identification_verification_status: Option<String>,
    #[ts(optional)]
    pub type_status: Option<String>,
    #[ts(optional)]
    pub is_agreement: Option<bool>,
    pub date_identified: DateTime<Utc>,
    // Darwin Core taxonomy
    #[ts(optional)]
    pub vernacular_name: Option<String>,
    #[ts(optional)]
    pub kingdom: Option<String>,
    #[ts(optional)]
    pub phylum: Option<String>,
    #[ts(optional)]
    pub class: Option<String>,
    #[sqlx(rename = "order")]
    #[serde(rename = "order")]
    #[ts(optional)]
    pub order_: Option<String>,
    #[ts(optional)]
    pub family: Option<String>,
    #[ts(optional)]
    pub genus: Option<String>,
}

/// Comment row returned from SELECT queries
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
pub struct CommentRow {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub subject_uri: String,
    pub subject_cid: String,
    pub body: String,
    #[ts(optional)]
    pub reply_to_uri: Option<String>,
    #[ts(optional)]
    pub reply_to_cid: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Like row
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LikeRow {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub subject_uri: String,
    pub subject_cid: String,
    pub created_at: NaiveDateTime,
}

/// Interaction row returned from SELECT queries
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
pub struct InteractionRow {
    pub uri: String,
    pub cid: String,
    pub did: String,
    // Subject A
    #[ts(optional)]
    pub subject_a_occurrence_uri: Option<String>,
    #[ts(optional)]
    pub subject_a_occurrence_cid: Option<String>,
    #[ts(optional)]
    pub subject_a_subject_index: Option<i32>,
    #[ts(optional)]
    pub subject_a_taxon_name: Option<String>,
    #[ts(optional)]
    pub subject_a_kingdom: Option<String>,
    // Subject B
    #[ts(optional)]
    pub subject_b_occurrence_uri: Option<String>,
    #[ts(optional)]
    pub subject_b_occurrence_cid: Option<String>,
    #[ts(optional)]
    pub subject_b_subject_index: Option<i32>,
    #[ts(optional)]
    pub subject_b_taxon_name: Option<String>,
    #[ts(optional)]
    pub subject_b_kingdom: Option<String>,
    // Interaction details
    pub interaction_type: String,
    #[ts(as = "InteractionDirection")]
    pub direction: String,
    #[ts(optional)]
    pub comment: Option<String>,
    pub created_at: DateTime<Utc>,
    #[ts(optional)]
    pub indexed_at: Option<DateTime<Utc>>,
}

/// Observer row for multi-user observations
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ObserverRow {
    pub did: String,
    pub role: String,
    pub added_at: Option<DateTime<Utc>>,
}

/// Community ID row from the materialized view
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CommunityIdRow {
    pub occurrence_uri: String,
    pub subject_index: i32,
    pub scientific_name: String,
    pub kingdom: Option<String>,
    pub id_count: i64,
    pub agreement_count: i64,
}

/// Private location data row
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OccurrencePrivateDataRow {
    pub exact_latitude: f64,
    pub exact_longitude: f64,
    pub geoprivacy: String,
    pub effective_geoprivacy: Option<String>,
}

/// Subject info (aggregated from identifications)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SubjectInfo {
    pub subject_index: i32,
    pub identification_count: i64,
    pub latest_identification: Option<DateTime<Utc>>,
}

/// Parameters for upserting an occurrence
#[derive(Debug, Clone)]
pub struct UpsertOccurrenceParams {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub scientific_name: Option<String>,
    pub event_date: DateTime<Utc>,
    pub longitude: f64,
    pub latitude: f64,
    pub coordinate_uncertainty_meters: Option<i32>,
    pub continent: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub state_province: Option<String>,
    pub county: Option<String>,
    pub municipality: Option<String>,
    pub locality: Option<String>,
    pub water_body: Option<String>,
    pub verbatim_locality: Option<String>,
    pub occurrence_remarks: Option<String>,
    pub associated_media: Option<serde_json::Value>,
    pub recorded_by: Option<String>,
    pub taxon_id: Option<String>,
    pub taxon_rank: Option<String>,
    pub vernacular_name: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Parameters for upserting an identification
#[derive(Debug, Clone)]
pub struct UpsertIdentificationParams {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub subject_uri: String,
    pub subject_cid: String,
    pub subject_index: i32,
    pub scientific_name: String,
    pub taxon_rank: Option<String>,
    pub taxon_id: Option<String>,
    pub identification_remarks: Option<String>,
    pub is_agreement: bool,
    pub date_identified: NaiveDateTime,
    pub vernacular_name: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
}

/// Parameters for upserting a comment
#[derive(Debug, Clone)]
pub struct UpsertCommentParams {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub subject_uri: String,
    pub subject_cid: String,
    pub body: String,
    pub reply_to_uri: Option<String>,
    pub reply_to_cid: Option<String>,
    pub created_at: NaiveDateTime,
}

/// Parameters for upserting an interaction
#[derive(Debug, Clone)]
pub struct UpsertInteractionParams {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub subject_a_occurrence_uri: Option<String>,
    pub subject_a_occurrence_cid: Option<String>,
    pub subject_a_subject_index: i32,
    pub subject_a_taxon_name: Option<String>,
    pub subject_a_kingdom: Option<String>,
    pub subject_b_occurrence_uri: Option<String>,
    pub subject_b_occurrence_cid: Option<String>,
    pub subject_b_subject_index: i32,
    pub subject_b_taxon_name: Option<String>,
    pub subject_b_kingdom: Option<String>,
    pub interaction_type: String,
    pub direction: String,
    pub comment: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Parameters for creating a like
#[derive(Debug, Clone)]
pub struct CreateLikeParams {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub subject_uri: String,
    pub subject_cid: String,
    pub created_at: NaiveDateTime,
}

/// Options for explore feed queries
#[derive(Debug, Clone, Default)]
pub struct ExploreFeedOptions {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub taxon: Option<String>,
    pub kingdom: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius: Option<f64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// Options for profile feed queries
#[derive(Debug, Clone, Default)]
pub struct ProfileFeedOptions {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub feed_type: Option<ProfileFeedType>,
}

#[derive(Debug, Clone, Default)]
pub enum ProfileFeedType {
    Observations,
    Identifications,
    #[default]
    All,
}

/// Result of a profile feed query
#[derive(Debug, Clone)]
pub struct ProfileFeedResult {
    pub occurrences: Vec<OccurrenceRow>,
    pub identifications: Vec<IdentificationRow>,
    pub counts: ProfileCounts,
}

#[derive(Debug, Clone)]
pub struct ProfileCounts {
    pub observations: i64,
    pub identifications: i64,
    pub species: i64,
}

/// Result of a home feed query
#[derive(Debug, Clone)]
pub struct HomeFeedResult {
    pub rows: Vec<OccurrenceRow>,
    pub followed_count: usize,
    pub nearby_count: usize,
}

/// Options for home feed queries
#[derive(Debug, Clone, Default)]
pub struct HomeFeedOptions {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub nearby_radius: Option<f64>,
}

/// Options for taxon occurrence queries
#[derive(Debug, Clone, Default)]
pub struct TaxonOccurrenceOptions {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub kingdom: Option<String>,
}
