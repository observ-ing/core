//! Data types for taxonomy service

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// IUCN Red List conservation status categories
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IucnCategory {
    /// Extinct
    EX,
    /// Extinct in the Wild
    EW,
    /// Critically Endangered
    CR,
    /// Endangered
    EN,
    /// Vulnerable
    VU,
    /// Near Threatened
    NT,
    /// Least Concern
    LC,
    /// Data Deficient
    DD,
    /// Not Evaluated
    NE,
}

impl IucnCategory {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "EX" => Some(Self::EX),
            "EW" => Some(Self::EW),
            "CR" => Some(Self::CR),
            "EN" => Some(Self::EN),
            "VU" => Some(Self::VU),
            "NT" => Some(Self::NT),
            "LC" => Some(Self::LC),
            "DD" => Some(Self::DD),
            "NE" => Some(Self::NE),
            _ => None,
        }
    }
}

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

// GBIF API response types
// These structs mirror the GBIF API responses - some fields may not be used
// but are kept for completeness and future use.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifSpeciesDetail {
    pub key: Option<u64>,
    pub scientific_name: Option<String>,
    pub canonical_name: Option<String>,
    pub vernacular_name: Option<String>,
    pub rank: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub species: Option<String>,
    pub kingdom_key: Option<u64>,
    pub phylum_key: Option<u64>,
    pub class_key: Option<u64>,
    pub order_key: Option<u64>,
    pub family_key: Option<u64>,
    pub genus_key: Option<u64>,
    pub species_key: Option<u64>,
    pub num_descendants: Option<u64>,
    pub extinct: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifSuggestResult {
    pub key: Option<u64>,
    pub usage_key: Option<u64>,
    pub scientific_name: Option<String>,
    pub canonical_name: Option<String>,
    pub vernacular_name: Option<String>,
    pub rank: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub species: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifV2NameUsage {
    // GBIF v2 API returns key as a string
    #[serde(deserialize_with = "deserialize_key")]
    pub key: Option<u64>,
    pub name: Option<String>,
    pub canonical_name: Option<String>,
    pub rank: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub species: Option<String>,
}

// Helper to deserialize key that can be either string or number
fn deserialize_key<'de, D>(deserializer: D) -> std::result::Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct KeyVisitor;

    impl<'de> Visitor<'de> for KeyVisitor {
        type Value = Option<u64>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or integer representing a key")
        }

        fn visit_u64<E>(self, v: u64) -> std::result::Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(v))
        }

        fn visit_i64<E>(self, v: i64) -> std::result::Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(v as u64))
        }

        fn visit_str<E>(self, v: &str) -> std::result::Result<Self::Value, E>
        where
            E: de::Error,
        {
            v.parse::<u64>().map(Some).map_err(de::Error::custom)
        }

        fn visit_none<E>(self) -> std::result::Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> std::result::Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }
    }

    deserializer.deserialize_any(KeyVisitor)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifV2AdditionalStatus {
    pub status: Option<String>,
    pub status_code: Option<String>,
    pub dataset_alias: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifV2Diagnostics {
    pub match_type: Option<String>,
    pub confidence: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifV2MatchResult {
    #[serde(default)]
    pub synonym: bool,
    pub usage: Option<GbifV2NameUsage>,
    pub classification: Option<Vec<GbifV2NameUsage>>,
    pub additional_status: Option<Vec<GbifV2AdditionalStatus>>,
    pub diagnostics: Option<GbifV2Diagnostics>,
}

#[derive(Debug, Deserialize)]
pub struct GbifListResponse<T> {
    pub results: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifDescription {
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub language: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifReference {
    pub citation: Option<String>,
    pub r#type: Option<String>,
    pub source: Option<String>,
    pub doi: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GbifMedia {
    pub r#type: Option<String>,
    pub format: Option<String>,
    pub identifier: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
}
