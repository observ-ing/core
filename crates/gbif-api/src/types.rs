//! Data types for GBIF API responses
//!
//! These structs mirror the GBIF API responses. Some fields may not be used
//! but are kept for completeness and future use.

use serde::{Deserialize, Serialize};

/// IUCN Red List conservation status categories
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    /// Parse an IUCN category from a string code
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

/// Species detail from GBIF v1 `/species/{id}` endpoint
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesDetail {
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

/// Result from GBIF v1 `/species/suggest` endpoint
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestResult {
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

/// Name usage data from GBIF v2 API
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2NameUsage {
    /// GBIF v2 API returns key as either a string or number
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

/// Helper to deserialize key that can be either string or number
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

/// Additional status information from GBIF v2 match (includes IUCN status)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2AdditionalStatus {
    pub status: Option<String>,
    pub status_code: Option<String>,
    pub dataset_alias: Option<String>,
}

/// Diagnostics from GBIF v2 match
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2Diagnostics {
    pub match_type: Option<String>,
    pub confidence: Option<u32>,
}

/// Complete match result from GBIF v2 `/species/match` endpoint
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2MatchResult {
    #[serde(default)]
    pub synonym: bool,
    pub usage: Option<V2NameUsage>,
    pub classification: Option<Vec<V2NameUsage>>,
    pub additional_status: Option<Vec<V2AdditionalStatus>>,
    pub diagnostics: Option<V2Diagnostics>,
}

/// Generic paginated list response from GBIF API
#[derive(Debug, Clone, Deserialize)]
pub struct ListResponse<T> {
    pub results: Vec<T>,
}

/// Description from GBIF `/species/{id}/descriptions` endpoint
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Description {
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub language: Option<String>,
    pub source: Option<String>,
}

/// Reference/citation from GBIF `/species/{id}/references` endpoint
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub citation: Option<String>,
    pub r#type: Option<String>,
    pub source: Option<String>,
    pub doi: Option<String>,
    pub link: Option<String>,
}

/// Media item from GBIF `/species/{id}/media` endpoint
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub r#type: Option<String>,
    pub format: Option<String>,
    pub identifier: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
}
