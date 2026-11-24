//! Wire types shared between the `observing-species-id` service and the
//! `observing-appview` client. Lives in its own crate so the appview
//! doesn't pull in the heavy ONNX / image / h3o dependencies of the
//! service implementation just to deserialize a JSON response.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Request body for the species-id `/identify` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded image data
    pub image: String,
    /// Latitude for geo-prior reranking
    #[serde(default)]
    pub latitude: Option<f64>,
    /// Longitude for geo-prior reranking
    #[serde(default)]
    pub longitude: Option<f64>,
    /// Number of suggestions to return (default: 5)
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    5
}

/// A single ranked species suggestion returned by the identification service.
///
/// `kingdom` is used by the frontend for the taxon link target and is passed
/// to GBIF's `match_name` as a disambiguator when the appview enriches a
/// missing common name. `kingdom` through `genus` together let the frontend
/// roll ambiguous candidates up to their shared ancestor (e.g. five bluets →
/// *Enallagma* sp.); without the lower ranks the rollup can only land on
/// kingdom.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct SpeciesSuggestion {
    pub scientific_name: String,
    pub confidence: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub common_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kingdom: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub phylum: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub order: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub genus: Option<String>,
    /// Whether this species' iNat range covers the request lat/lon.
    /// `None` when geo lookup wasn't performed (no lat/lon, no geo index)
    /// or when the cell at the request point is unknown to the index — i.e.
    /// the field is only populated with an opinion when one is well-founded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub in_range: Option<bool>,
}

/// A rank above species that a [`RankFallback`] can land on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "bindings/")]
pub enum TaxonRank {
    Kingdom,
    Phylum,
    Class,
    Order,
    Family,
    Genus,
}

/// The most specific taxon above species that the model is confident about,
/// for photos where it can't tell close relatives apart (e.g. "Bumble bees,
/// *Bombus*" when no single *Bombus* species stands out).
///
/// `kingdom` through `family` hold this taxon's ancestors, so only the ranks
/// above `rank` are ever set. `kingdom` is the hint for GBIF lookups.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct RankFallback {
    pub rank: TaxonRank,
    pub scientific_name: String,
    /// Share of the model's probability that falls on species in this taxon,
    /// from 0 to 1. Not on the same scale as [`SpeciesSuggestion::confidence`],
    /// which is a raw similarity score.
    pub confidence: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kingdom: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub phylum: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub order: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub family: Option<String>,
}

/// Top-level response shape for the species-id `/identify` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyResponse {
    pub suggestions: Vec<SpeciesSuggestion>,
    /// A broader answer for when the top species isn't confident but its
    /// genus (or family, and so on) is. Absent when the top species is
    /// confident enough on its own, when no rank is, and from services that
    /// predate it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<RankFallback>,
    pub model_version: String,
    pub inference_time_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identify_response_without_fallback_still_parses() {
        let json = r#"{"suggestions":[],"modelVersion":"v","inferenceTimeMs":1}"#;
        let response: IdentifyResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.fallback, None);
        assert_eq!(
            serde_json::to_string(&response).unwrap(),
            json,
            "a missing fallback stays off the wire"
        );
    }

    #[test]
    fn fallback_rank_serializes_lowercase() {
        let fallback = RankFallback {
            rank: TaxonRank::Genus,
            scientific_name: "Bombus".into(),
            confidence: 0.8,
            kingdom: Some("Animalia".into()),
            phylum: None,
            class: None,
            order: None,
            family: Some("Apidae".into()),
        };
        assert_eq!(
            serde_json::to_string(&fallback).unwrap(),
            r#"{"rank":"genus","scientificName":"Bombus","confidence":0.8,"kingdom":"Animalia","family":"Apidae"}"#
        );
    }
}
