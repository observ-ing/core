//! Wikidata SPARQL client for fetching taxon images via GBIF taxon IDs

use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use tracing::warn;

const WIKIDATA_SPARQL_ENDPOINT: &str = "https://query.wikidata.org/sparql";

#[derive(Debug, Deserialize)]
struct SparqlResponse {
    results: SparqlResults,
}

#[derive(Debug, Deserialize)]
struct SparqlResults {
    bindings: Vec<SparqlBinding>,
}

#[derive(Debug, Deserialize)]
struct SparqlBinding {
    gbif_taxon_id: SparqlValue,
    image: Option<SparqlValue>,
}

#[derive(Debug, Deserialize)]
struct SparqlValue {
    value: String,
}

/// Client for fetching taxon images from Wikidata using GBIF taxon IDs
pub struct WikidataClient {
    client: Client,
}

impl WikidataClient {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent("Observing/1.0 (https://observ.ing; taxonomy service)")
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    /// Fetch images for multiple taxa by their GBIF taxon IDs
    /// Returns a map of gbif_key -> image_url
    pub async fn get_images_for_keys(&self, keys: &[u64]) -> HashMap<u64, String> {
        if keys.is_empty() {
            return HashMap::new();
        }

        // Build SPARQL VALUES clause with quoted string IDs
        let values: String = keys.iter().map(|k| format!("\"{}\"", k)).collect::<Vec<_>>().join(" ");

        let query = format!(
            r#"
SELECT ?gbif_taxon_id (SAMPLE(?image) AS ?image) WHERE {{
    VALUES ?gbif_taxon_id {{ {} }} .
    ?item wdt:P846 ?gbif_taxon_id .
    OPTIONAL {{ ?item wdt:P18 ?image }} .
}} GROUP BY ?gbif_taxon_id
"#,
            values
        );

        // Build URL with query parameters
        let url = format!(
            "{}?query={}&format=json",
            WIKIDATA_SPARQL_ENDPOINT,
            urlencoding::encode(&query)
        );

        let response = match self.client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                warn!(error = ?e, "Wikidata SPARQL request failed");
                return HashMap::new();
            }
        };

        if !response.status().is_success() {
            warn!(status = %response.status(), "Wikidata SPARQL returned error status");
            return HashMap::new();
        }

        let data: SparqlResponse = match response.json().await {
            Ok(d) => d,
            Err(e) => {
                warn!(error = ?e, "Failed to parse Wikidata SPARQL response");
                return HashMap::new();
            }
        };

        let mut result = HashMap::new();
        for binding in data.results.bindings {
            if let Some(image) = binding.image {
                if let Ok(key) = binding.gbif_taxon_id.value.parse::<u64>() {
                    // Convert Wikimedia Commons URL to a thumbnail URL
                    let thumb_url = Self::to_thumbnail_url(&image.value, 100);
                    result.insert(key, thumb_url);
                }
            }
        }

        result
    }

    /// Convert a Wikimedia Commons file URL to a thumbnail URL
    /// Example: "http://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg"
    /// becomes a 100px thumbnail
    fn to_thumbnail_url(file_url: &str, width: u32) -> String {
        // The FilePath URL redirects to the full image. For thumbnails, we need
        // to construct a thumb URL. However, that requires knowing the MD5 hash.
        // For simplicity, we'll use the Special:FilePath with width parameter.
        if file_url.contains("Special:FilePath/") {
            format!("{}?width={}", file_url, width)
        } else {
            file_url.to_string()
        }
    }
}

impl Default for WikidataClient {
    fn default() -> Self {
        Self::new()
    }
}
