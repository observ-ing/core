//! Wikidata client for biodiversity lookups: taxon images and entity URLs via
//! external identifiers (e.g. GBIF taxon ids).
//!
//! A thin domain layer over [`sparql_client`], pinned to Wikidata's public
//! query service. For raw SPARQL against arbitrary endpoints, use
//! [`sparql_client::SparqlClient`] directly.
//!
//! # Example
//!
//! ```no_run
//! use wikidata_client::WikidataClient;
//!
//! # async fn example() {
//! let client = WikidataClient::new();
//!
//! // Fetch images for GBIF taxon IDs (property P846).
//! let images = client.get_images_by_property("P846", &["2480528", "5219243"], 100).await;
//! # }
//! ```

use sparql_client::{escape_literal, SparqlClient};
use std::collections::HashMap;
use tracing::warn;

// Re-export the shared SPARQL types so callers don't need a direct dependency
// on `sparql-client` for the values these methods return.
pub use sparql_client::{Error, SparqlBinding, SparqlValue};

const WIKIDATA_ENDPOINT: &str = "https://query.wikidata.org/sparql";
const DEFAULT_USER_AGENT: &str = "wikidata-client/0.1 (Rust; https://github.com/observ-ing/core)";

/// Client for querying Wikidata's SPARQL endpoint for biodiversity data.
pub struct WikidataClient {
    client: SparqlClient,
}

impl WikidataClient {
    /// Create a new client with a default user agent.
    pub fn new() -> Self {
        Self::with_user_agent(DEFAULT_USER_AGENT)
    }

    /// Create a new client with a custom user agent.
    ///
    /// Wikidata's query service requires a meaningful user agent — requests
    /// with generic agents may be throttled or blocked.
    pub fn with_user_agent(user_agent: &str) -> Self {
        Self {
            client: SparqlClient::with_user_agent(WIKIDATA_ENDPOINT, user_agent),
        }
    }

    /// Execute a raw SELECT-style SPARQL query against Wikidata.
    pub async fn sparql_query(&self, query: &str) -> Result<Vec<SparqlBinding>, Error> {
        self.client.sparql_query(query).await
    }

    /// Fetch Wikidata entity URLs for items matching external IDs on a given property.
    ///
    /// For example, to find Wikidata items by GBIF taxon ID (property P846):
    /// ```no_run
    /// # use wikidata_client::WikidataClient;
    /// # async fn example() {
    /// let client = WikidataClient::new();
    /// let entities = client.get_entities_by_property("P846", &["2480528"]).await;
    /// // Returns: {"2480528": "https://www.wikidata.org/wiki/Q158746"}
    /// # }
    /// ```
    pub async fn get_entities_by_property(
        &self,
        property: &str,
        ids: &[&str],
    ) -> HashMap<String, String> {
        if ids.is_empty() || !is_property_id(property) {
            return HashMap::new();
        }

        let values: String = ids
            .iter()
            .map(|id| format!("\"{}\"", escape_literal(id)))
            .collect::<Vec<_>>()
            .join(" ");

        let query = format!(
            r"SELECT ?external_id ?item WHERE {{
    VALUES ?external_id {{ {values} }} .
    ?item wdt:{property} ?external_id .
}}",
        );

        let bindings = match self.client.sparql_query(&query).await {
            Ok(b) => b,
            Err(e) => {
                warn!(error = ?e, "Wikidata entity lookup failed");
                return HashMap::new();
            }
        };

        let mut result = HashMap::new();
        for binding in bindings {
            if let (Some(id), Some(item)) = (binding.get("external_id"), binding.get("item")) {
                let url = item.value.replace(
                    "http://www.wikidata.org/entity/",
                    "https://www.wikidata.org/wiki/",
                );
                result.insert(id.value.clone(), url);
            }
        }

        result
    }

    /// Cross-walk an external taxon identifier to a GBIF backbone usage key.
    ///
    /// Finds the Wikidata item carrying `external_id` on `source_property`
    /// (e.g. `P3151` for iNaturalist taxon id) and reads its GBIF ID
    /// (`P846`). Returns `None` if no item matches, the item has no GBIF ID,
    /// the GBIF ID isn't an integer, or the query fails.
    pub async fn gbif_key_for(&self, source_property: &str, external_id: &str) -> Option<i64> {
        if !is_property_id(source_property) {
            return None;
        }
        let query = format!(
            r#"SELECT ?gbif WHERE {{
    ?item wdt:{source_property} "{}" .
    ?item wdt:P846 ?gbif .
}} LIMIT 1"#,
            escape_literal(external_id),
        );
        self.first_gbif_key(&query).await
    }

    /// Cross-walk a Wikidata entity id (e.g. `Q158746`) to a GBIF backbone
    /// usage key by reading its GBIF ID (`P846`). Returns `None` on a
    /// non-Q-id, a missing/ non-integer GBIF ID, or a query failure.
    pub async fn gbif_key_for_entity(&self, qid: &str) -> Option<i64> {
        // `qid` is interpolated unquoted as `wd:{qid}`, so guard against
        // anything that isn't a bare item id before it reaches the query.
        let is_qid = matches!(qid.strip_prefix('Q'), Some(d)
            if !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()));
        if !is_qid {
            return None;
        }
        let query = format!(
            r#"SELECT ?gbif WHERE {{
    wd:{qid} wdt:P846 ?gbif .
}} LIMIT 1"#,
        );
        self.first_gbif_key(&query).await
    }

    /// Run a SPARQL query whose first binding exposes a `?gbif` literal and
    /// parse it as a GBIF usage key.
    async fn first_gbif_key(&self, query: &str) -> Option<i64> {
        let bindings = match self.client.sparql_query(query).await {
            Ok(b) => b,
            Err(e) => {
                warn!(error = ?e, "Wikidata GBIF cross-walk failed");
                return None;
            }
        };
        bindings
            .first()
            .and_then(|b| b.get("gbif"))
            .and_then(|v| v.value.parse::<i64>().ok())
    }

    /// Fetch images (Wikidata property P18) for items matching external IDs.
    ///
    /// Returns a map of external ID to Wikimedia Commons thumbnail URL, with the
    /// thumbnail rendered at `thumbnail_width` pixels.
    ///
    /// For example, to get images for GBIF taxon IDs:
    /// ```no_run
    /// # use wikidata_client::WikidataClient;
    /// # async fn example() {
    /// let client = WikidataClient::new();
    /// let images = client.get_images_by_property("P846", &["2480528", "5219243"], 100).await;
    /// // Returns: {"2480528": "http://commons.wikimedia.org/...?width=100"}
    /// # }
    /// ```
    pub async fn get_images_by_property(
        &self,
        property: &str,
        ids: &[&str],
        thumbnail_width: u32,
    ) -> HashMap<String, String> {
        if ids.is_empty() || !is_property_id(property) {
            return HashMap::new();
        }

        let values: String = ids
            .iter()
            .map(|id| format!("\"{}\"", escape_literal(id)))
            .collect::<Vec<_>>()
            .join(" ");

        let query = format!(
            r"SELECT ?external_id (SAMPLE(?image) AS ?image) WHERE {{
    VALUES ?external_id {{ {values} }} .
    ?item wdt:{property} ?external_id .
    OPTIONAL {{ ?item wdt:P18 ?image }} .
}} GROUP BY ?external_id",
        );

        let bindings = match self.client.sparql_query(&query).await {
            Ok(b) => b,
            Err(e) => {
                warn!(error = ?e, "Wikidata image lookup failed");
                return HashMap::new();
            }
        };

        let mut result = HashMap::new();
        for binding in bindings {
            if let (Some(id), Some(image)) = (binding.get("external_id"), binding.get("image")) {
                let thumb_url = to_thumbnail_url(&image.value, thumbnail_width);
                result.insert(id.value.clone(), thumb_url);
            }
        }

        result
    }
}

impl Default for WikidataClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether `p` is a bare Wikidata property id (`P` followed by digits).
///
/// Property ids are interpolated unquoted as `wdt:{p}`, so they must be
/// validated rather than escaped.
fn is_property_id(p: &str) -> bool {
    matches!(p.strip_prefix('P'), Some(d) if !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
}

/// Convert a Wikimedia Commons `Special:FilePath` URL to a thumbnail URL.
///
/// ```
/// use wikidata_client::to_thumbnail_url;
///
/// let url = "http://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg";
/// assert_eq!(to_thumbnail_url(url, 200), format!("{}?width=200", url));
///
/// let other = "https://example.com/image.jpg";
/// assert_eq!(to_thumbnail_url(other, 200), other);
/// ```
pub fn to_thumbnail_url(file_url: &str, width: u32) -> String {
    if file_url.contains("Special:FilePath/") {
        format!("{file_url}?width={width}")
    } else {
        file_url.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thumbnail_url_with_filepath() {
        let url = "http://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg";
        assert_eq!(
            to_thumbnail_url(url, 100),
            "http://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=100"
        );
    }

    #[test]
    fn test_thumbnail_url_without_filepath() {
        let url = "https://example.com/image.jpg";
        assert_eq!(to_thumbnail_url(url, 100), url);
    }

    #[test]
    fn test_thumbnail_url_custom_width() {
        let url = "http://commons.wikimedia.org/wiki/Special:FilePath/Example.png";
        assert_eq!(
            to_thumbnail_url(url, 300),
            "http://commons.wikimedia.org/wiki/Special:FilePath/Example.png?width=300"
        );
    }

    #[test]
    fn test_is_property_id() {
        assert!(is_property_id("P846"));
        assert!(is_property_id("P1"));
        assert!(!is_property_id("P"));
        assert!(!is_property_id("846"));
        assert!(!is_property_id("Q846"));
        assert!(!is_property_id("P846; DROP"));
        assert!(!is_property_id(""));
    }
}
