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

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tracing::warn;

const SPARQL_ENDPOINT: &str = "https://query.wikidata.org/sparql";
const DEFAULT_USER_AGENT: &str = "wikidata-client/0.1 (Rust; https://github.com/observ-ing/core)";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// A single value (RDF term) returned in a SPARQL result binding.
#[derive(Debug, Clone, Deserialize)]
pub struct SparqlValue {
    /// `"uri"`, `"literal"`, `"bnode"`, or `"typed-literal"`.
    #[serde(rename = "type")]
    pub value_type: Option<String>,
    pub value: String,
    /// Datatype IRI for typed literals, e.g. `http://www.w3.org/2001/XMLSchema#integer`.
    pub datatype: Option<String>,
    #[serde(rename = "xml:lang")]
    pub lang: Option<String>,
}

/// A row of results from a SPARQL query, mapping variable names to values.
pub type SparqlBinding = HashMap<String, SparqlValue>;

/// Full SPARQL JSON results — handles SELECT (`results.bindings`) and ASK (`boolean`).
#[derive(Debug, Default, Deserialize)]
struct SparqlResponse {
    #[serde(default)]
    results: SparqlResults,
    /// Present only for ASK queries.
    boolean: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
struct SparqlResults {
    #[serde(default)]
    bindings: Vec<SparqlBinding>,
}

/// Client for querying Wikidata's SPARQL endpoint.
pub struct WikidataClient {
    client: Client,
    endpoint: String,
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
    ///
    /// Panics if the underlying HTTP client cannot be built; use
    /// [`try_with_user_agent`](Self::try_with_user_agent) to handle that case.
    pub fn with_user_agent(user_agent: &str) -> Self {
        Self::try_with_user_agent(user_agent).expect("reqwest client should build")
    }

    /// Fallible constructor that surfaces HTTP-client build errors instead of
    /// silently falling back to a default client.
    pub fn try_with_user_agent(user_agent: &str) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .user_agent(user_agent)
                .timeout(DEFAULT_TIMEOUT)
                .build()?,
            endpoint: SPARQL_ENDPOINT.to_string(),
        })
    }

    /// Point the client at a different SPARQL endpoint — e.g. the WDQS scholarly
    /// split endpoint, or another Wikibase instance.
    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    /// Execute a SELECT-style SPARQL query and return the result bindings.
    pub async fn sparql_query(&self, query: &str) -> Result<Vec<SparqlBinding>, Error> {
        Ok(self.run(query).await?.results.bindings)
    }

    /// Execute an `ASK { … }` query.
    pub async fn sparql_ask(&self, query: &str) -> Result<bool, Error> {
        self.run(query).await?.boolean.ok_or(Error::UnexpectedShape)
    }

    /// Send a query to the endpoint and parse the SPARQL JSON response.
    async fn run(&self, query: &str) -> Result<SparqlResponse, Error> {
        let response = self
            .client
            .post(&self.endpoint)
            // Send the query in the body so long queries don't hit URL-length limits.
            .header(CONTENT_TYPE, "application/sparql-query")
            .header(ACCEPT, "application/sparql-results+json")
            .body(query.to_string())
            .send()
            .await
            .map_err(Error::Transport)?;

        let status = response.status();
        if !status.is_success() {
            // WDQS reports query-timeout / syntax errors in the body — keep a snippet.
            let body = response.text().await.unwrap_or_default();
            return Err(Error::Status {
                status,
                body: truncate(&body, 512),
            });
        }

        response
            .json::<SparqlResponse>()
            .await
            .map_err(Error::Decode)
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

/// Escape a string for use inside a SPARQL double-quoted literal.
///
/// Without this, a value containing `"`, `\`, or a newline breaks the query
/// (or allows injection). See the SPARQL 1.1 `STRING_LITERAL` grammar.
///
/// ```
/// use wikidata_client::escape_literal;
///
/// assert_eq!(escape_literal(r#"a "b" \ c"#), r#"a \"b\" \\ c"#);
/// ```
pub fn escape_literal(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str(r"\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str(r"\n"),
            '\r' => out.push_str(r"\r"),
            '\t' => out.push_str(r"\t"),
            _ => out.push(c),
        }
    }
    out
}

/// Whether `p` is a bare Wikidata property id (`P` followed by digits).
///
/// Property ids are interpolated unquoted as `wdt:{p}`, so they must be
/// validated rather than escaped.
fn is_property_id(p: &str) -> bool {
    matches!(p.strip_prefix('P'), Some(d) if !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
}

/// Truncate a string to at most `max` bytes, appending `…` if it was cut.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
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
    /// The request never completed (DNS, TLS, connect, or timeout).
    Transport(reqwest::Error),
    /// The endpoint returned a non-success status. `body` is a truncated
    /// snippet of the response — WDQS reports query timeouts and syntax
    /// errors there.
    Status { status: StatusCode, body: String },
    /// The response could not be decoded as SPARQL JSON.
    Decode(reqwest::Error),
    /// The response was valid JSON but not the expected shape (e.g. an ASK
    /// query returned no `boolean`).
    UnexpectedShape,
}

impl Error {
    /// HTTP 429 / 503 — the caller may retry with backoff.
    pub fn is_throttled(&self) -> bool {
        matches!(self, Error::Status { status, .. }
            if *status == StatusCode::TOO_MANY_REQUESTS
                || *status == StatusCode::SERVICE_UNAVAILABLE)
    }

    /// The request timed out.
    pub fn is_timeout(&self) -> bool {
        matches!(self, Error::Transport(e) if e.is_timeout())
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Transport(e) => write!(f, "Wikidata request error: {e}"),
            Error::Status { status, body } => {
                write!(f, "Wikidata HTTP error: {status}: {body}")
            }
            Error::Decode(e) => write!(f, "Wikidata response decode error: {e}"),
            Error::UnexpectedShape => write!(f, "Wikidata response had an unexpected shape"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Transport(e) | Error::Decode(e) => Some(e),
            Error::Status { .. } | Error::UnexpectedShape => None,
        }
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
    fn test_escape_literal() {
        assert_eq!(escape_literal("plain"), "plain");
        assert_eq!(escape_literal(r#"say "hi""#), r#"say \"hi\""#);
        assert_eq!(escape_literal(r"back\slash"), r"back\\slash");
        assert_eq!(escape_literal("line\nbreak"), r"line\nbreak");
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

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("short", 10), "short");
        assert_eq!(truncate("abcdef", 3), "abc…");
        // Does not split a multi-byte char.
        assert_eq!(truncate("aé", 2), "a…");
    }
}
