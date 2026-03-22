//! Wikidata integration for taxon images and entity lookups via GBIF taxon IDs.
//!
//! Thin wrapper around `wikidata_client` that works with GBIF numeric keys.

use std::collections::HashMap;
use wikidata_client::WikidataClient as Client;

/// Client for fetching taxon data from Wikidata using GBIF taxon IDs (property P846).
pub struct WikidataClient {
    client: Client,
}

impl WikidataClient {
    pub fn new() -> Self {
        Self {
            client: Client::with_user_agent(
                "Observing/1.0 (https://observ.ing; taxonomy service)",
            ),
        }
    }

    /// Fetch images for multiple taxa by their GBIF taxon IDs.
    /// Returns a map of gbif_key -> thumbnail URL.
    pub async fn get_images_for_keys(&self, keys: &[u64]) -> HashMap<u64, String> {
        let string_keys: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
        let str_keys: Vec<&str> = string_keys.iter().map(|s| s.as_str()).collect();

        let results = self.client.get_images_by_property("P846", &str_keys).await;

        results
            .into_iter()
            .filter_map(|(k, v)| k.parse::<u64>().ok().map(|id| (id, v)))
            .collect()
    }

    /// Get the Wikidata entity URL for a GBIF taxon ID.
    /// Returns e.g. `"https://www.wikidata.org/wiki/Q12345"`.
    pub async fn get_entity_url(&self, gbif_key: u64) -> Option<String> {
        let key_str = gbif_key.to_string();
        let results = self
            .client
            .get_entities_by_property("P846", &[key_str.as_str()])
            .await;
        results.into_values().next()
    }
}

impl Default for WikidataClient {
    fn default() -> Self {
        Self::new()
    }
}
