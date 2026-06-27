//! Minimal async SPARQL-over-HTTP client.
//!
//! Sends queries to a SPARQL endpoint over HTTP POST and parses the standard
//! SPARQL 1.1 JSON results format. Endpoint-agnostic: point it at Wikidata, a
//! local Oxigraph, or any other SPARQL service.
//!
//! # Example
//!
//! ```no_run
//! use sparql_client::SparqlClient;
//!
//! # async fn example() {
//! let client = SparqlClient::new("https://query.wikidata.org/sparql");
//!
//! let rows = client
//!     .sparql_query("SELECT ?item WHERE { ?item wdt:P31 wd:Q5 } LIMIT 5")
//!     .await
//!     .unwrap();
//! # }
//! ```

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

const DEFAULT_USER_AGENT: &str = "sparql-client/0.1 (Rust)";
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

/// Async client for a single SPARQL endpoint.
pub struct SparqlClient {
    client: Client,
    endpoint: String,
}

impl SparqlClient {
    /// Create a client for `endpoint` with a default user agent.
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self::with_user_agent(endpoint, DEFAULT_USER_AGENT)
    }

    /// Create a client for `endpoint` with a custom user agent.
    ///
    /// Many public endpoints (Wikidata in particular) require a meaningful
    /// user agent — requests with generic agents may be throttled or blocked.
    ///
    /// Panics if the underlying HTTP client cannot be built; use
    /// [`try_with_user_agent`](Self::try_with_user_agent) to handle that case.
    pub fn with_user_agent(endpoint: impl Into<String>, user_agent: &str) -> Self {
        Self::try_with_user_agent(endpoint, user_agent).expect("reqwest client should build")
    }

    /// Fallible constructor that surfaces HTTP-client build errors instead of
    /// silently falling back to a default client.
    pub fn try_with_user_agent(
        endpoint: impl Into<String>,
        user_agent: &str,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .user_agent(user_agent)
                .timeout(DEFAULT_TIMEOUT)
                .build()?,
            endpoint: endpoint.into(),
        })
    }

    /// The endpoint URL this client targets.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
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
            // Endpoints report query-timeout / syntax errors in the body — keep a snippet.
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
}

/// Escape a string for use inside a SPARQL double-quoted literal.
///
/// Without this, a value containing `"`, `\`, or a newline breaks the query
/// (or allows injection). See the SPARQL 1.1 `STRING_LITERAL` grammar.
///
/// ```
/// use sparql_client::escape_literal;
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

/// Errors that can occur when querying a SPARQL endpoint.
#[derive(Debug)]
pub enum Error {
    /// The request never completed (DNS, TLS, connect, or timeout).
    Transport(reqwest::Error),
    /// The endpoint returned a non-success status. `body` is a truncated
    /// snippet of the response — endpoints report query timeouts and syntax
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
            Error::Transport(e) => write!(f, "SPARQL request error: {e}"),
            Error::Status { status, body } => write!(f, "SPARQL HTTP error: {status}: {body}"),
            Error::Decode(e) => write!(f, "SPARQL response decode error: {e}"),
            Error::UnexpectedShape => write!(f, "SPARQL response had an unexpected shape"),
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
    fn test_escape_literal() {
        assert_eq!(escape_literal("plain"), "plain");
        assert_eq!(escape_literal(r#"say "hi""#), r#"say \"hi\""#);
        assert_eq!(escape_literal(r"back\slash"), r"back\\slash");
        assert_eq!(escape_literal("line\nbreak"), r"line\nbreak");
    }

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("short", 10), "short");
        assert_eq!(truncate("abcdef", 3), "abc…");
        // Does not split a multi-byte char.
        assert_eq!(truncate("aé", 2), "a…");
    }
}
