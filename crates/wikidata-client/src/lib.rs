//! Wikidata SPARQL client for querying Wikidata's public query service.
//!
//! Provides a general-purpose SPARQL query executor and convenience methods
//! for common Wikidata lookups like fetching images by external identifiers.
//!
//! # Example
//!
//! ```no_run
//! use wikidata_client::WikidataClient;
//!
//! # async fn example() {
//! let client = WikidataClient::new();
//!
//! // Execute a raw SPARQL query
//! let bindings = client.sparql_query(
//!     r#"SELECT ?item ?itemLabel WHERE {
//!         ?item wdt:P31 wd:Q5 .
//!         SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
//!     } LIMIT 5"#,
//! ).await.unwrap();
//!
//! // Fetch images for GBIF taxon IDs
//! let images = client.get_images_by_property("P846", &["2480528", "5219243"], 100).await;
//! # }
//! ```

use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use tracing::warn;

const SPARQL_ENDPOINT: &str = "https://query.wikidata.org/sparql";

/// A single value returned in a SPARQL result binding.
#[derive(Debug, Clone, Deserialize)]
pub struct SparqlValue {
    pub value: String,
    #[serde(rename = "type")]
    pub value_type: Option<String>,
    #[serde(rename = "xml:lang")]
    pub lang: Option<String>,
}

/// A row of results from a SPARQL query, mapping variable names to values.
pub type SparqlBinding = HashMap<String, SparqlValue>;

#[derive(Debug, Deserialize)]
struct SparqlResults {
    bindings: Vec<SparqlBinding>,
}

#[derive(Debug, Deserialize)]
struct SparqlResponse {
    results: SparqlResults,
}

/// Client for querying Wikidata's SPARQL endpoint.
pub struct WikidataClient {
    client: Client,
}

impl WikidataClient {
    /// Create a new client with a default user agent.
    pub fn new() -> Self {
        Self::with_user_agent("wikidata-client/0.1 (Rust; https://github.com/observ-ing/core)")
    }

    /// Create a new client with a custom user agent.
    ///
    /// Wikidata's query service requires a meaningful user agent — requests
    /// with generic agents may be throttled or blocked.
    pub fn with_user_agent(user_agent: &str) -> Self {
        Self {
            client: Client::builder()
                .user_agent(user_agent)
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    /// Execute a SPARQL query and return the result bindings.
    pub async fn sparql_query(&self, query: &str) -> Result<Vec<SparqlBinding>, Error> {
        let url = format!(
            "{}?query={}&format=json",
            SPARQL_ENDPOINT,
            urlencoding::encode(query)
        );

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(Error::Http(format!(
                "SPARQL endpoint returned {}",
                response.status()
            )));
        }

        let data: SparqlResponse = response.json().await?;
        Ok(data.results.bindings)
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
        if ids.is_empty() {
            return HashMap::new();
        }

        let values: String = ids
            .iter()
            .map(|id| format!("\"{id}\""))
            .collect::<Vec<_>>()
            .join(" ");

        let query = format!(
            r"SELECT ?external_id ?item WHERE {{
    VALUES ?external_id {{ {values} }} .
    ?item wdt:{property} ?external_id .
}}",
        );

        let bindings = match self.sparql_query(&query).await {
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
        let query = format!(
            r#"SELECT ?gbif WHERE {{
    ?item wdt:{source_property} "{external_id}" .
    ?item wdt:P846 ?gbif .
}} LIMIT 1"#,
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
        let bindings = match self.sparql_query(query).await {
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
        if ids.is_empty() {
            return HashMap::new();
        }

        let values: String = ids
            .iter()
            .map(|id| format!("\"{id}\""))
            .collect::<Vec<_>>()
            .join(" ");

        let query = format!(
            r"SELECT ?external_id (SAMPLE(?image) AS ?image) WHERE {{
    VALUES ?external_id {{ {values} }} .
    ?item wdt:{property} ?external_id .
    OPTIONAL {{ ?item wdt:P18 ?image }} .
}} GROUP BY ?external_id",
        );

        let bindings = match self.sparql_query(&query).await {
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

/// Errors that can occur when querying Wikidata.
#[derive(Debug)]
pub enum Error {
    /// HTTP request failed.
    Request(reqwest::Error),
    /// SPARQL endpoint returned a non-success status.
    Http(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Request(e) => write!(f, "Wikidata request error: {}", e),
            Error::Http(msg) => write!(f, "Wikidata HTTP error: {}", msg),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Request(e) => Some(e),
            Error::Http(_) => None,
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Request(e)
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
}
