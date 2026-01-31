//! Data types for taxonomy service

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// Re-export IucnCategory from gbif-api
pub use gbif_api::IucnCategory;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConservationStatus {
    pub category: IucnCategory,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonResult {
    pub id: String,
    pub scientific_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub common_name: Option<String>,
    pub rank: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kingdom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phylum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genus: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub species: Option<String>,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conservation_status: Option<ConservationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonAncestor {
    pub id: String,
    pub name: String,
    pub rank: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonDescription {
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonReference {
    pub citation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonMedia {
    pub r#type: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonDetail {
    #[serde(flatten)]
    pub base: TaxonResult,
    pub ancestors: Vec<TaxonAncestor>,
    pub children: Vec<TaxonResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_descendants: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extinct: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descriptions: Option<Vec<TaxonDescription>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<TaxonReference>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<Vec<TaxonMedia>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gbif_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taxon: Option<TaxonResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<TaxonResult>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub cache: CacheStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub entries: u64,
    pub hits: u64,
    pub misses: u64,
}
