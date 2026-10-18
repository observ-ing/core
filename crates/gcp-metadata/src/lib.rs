//! Client for the GCP metadata server, which every Cloud Run instance can
//! reach at `metadata.google.internal`.
//!
//! Covers what observ.ing's services need from it: the project and region
//! they run in, and an access token for the service account they run as.
//! The token is cached until shortly before it expires.

use std::fmt;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use tokio::sync::Mutex;

const DEFAULT_BASE_URL: &str = "http://metadata.google.internal/computeMetadata/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Refresh a cached access token this long before it expires.
const TOKEN_EXPIRY_MARGIN: chrono::Duration = chrono::Duration::seconds(60);

pub struct Client {
    http: reqwest::Client,
    base_url: String,
    token: Mutex<Option<AccessToken>>,
}

#[derive(Debug)]
pub enum Error {
    Http(reqwest::Error),
    /// The metadata server answered with an error.
    Status {
        path: String,
        status: u16,
    },
    /// The answer wasn't what was expected.
    Parse {
        path: String,
        message: String,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Http(e) => write!(f, "metadata server request failed: {e}"),
            Error::Status { path, status } => {
                write!(f, "metadata server returned {status} for {path}")
            }
            Error::Parse { path, message } => {
                write!(f, "unexpected metadata server answer for {path}: {message}")
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Http(e) => Some(e),
            _ => None,
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Http(e)
    }
}

struct AccessToken {
    value: String,
    expires_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct MetadataToken {
    access_token: String,
    /// Seconds. Missing means don't reuse the token.
    #[serde(default)]
    expires_in: i64,
}

impl Default for Client {
    fn default() -> Self {
        Self::new()
    }
}

impl Client {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    /// A client for a metadata server at `base_url` (the
    /// `.../computeMetadata/v1` level), for tests.
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("reqwest client builds with a timeout"),
            base_url: base_url.trim_end_matches('/').to_string(),
            token: Mutex::new(None),
        }
    }

    /// The value at `path`, e.g. `project/project-id`.
    pub async fn metadata(&self, path: &str) -> Result<String, Error> {
        let response = self
            .http
            .get(format!("{}/{path}", self.base_url))
            .header("Metadata-Flavor", "Google")
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(Error::Status {
                path: path.to_string(),
                status: response.status().as_u16(),
            });
        }
        Ok(response.text().await?)
    }

    pub async fn project_id(&self) -> Result<String, Error> {
        Ok(self
            .metadata("project/project-id")
            .await?
            .trim()
            .to_string())
    }

    pub async fn project_number(&self) -> Result<String, Error> {
        Ok(self
            .metadata("project/numeric-project-id")
            .await?
            .trim()
            .to_string())
    }

    /// The region this instance runs in, e.g. `us-central1`.
    pub async fn region(&self) -> Result<String, Error> {
        Ok(region_name(&self.metadata("instance/region").await?).to_string())
    }

    /// An access token for the service account this instance runs as.
    pub async fn access_token(&self) -> Result<String, Error> {
        let mut cached = self.token.lock().await;
        if let Some(token) = cached.as_ref() {
            if Utc::now() + TOKEN_EXPIRY_MARGIN < token.expires_at {
                return Ok(token.value.clone());
            }
        }
        let path = "instance/service-accounts/default/token";
        let body = self.metadata(path).await?;
        let token: MetadataToken = serde_json::from_str(&body).map_err(|e| Error::Parse {
            path: path.to_string(),
            message: e.to_string(),
        })?;
        let value = token.access_token;
        *cached = Some(AccessToken {
            value: value.clone(),
            expires_at: Utc::now() + chrono::Duration::seconds(token.expires_in),
        });
        Ok(value)
    }
}

/// The metadata server gives the region as `projects/{number}/regions/{region}`.
fn region_name(metadata: &str) -> &str {
    metadata.rsplit('/').next().unwrap_or(metadata).trim()
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const TOKEN_PATH: &str = "/instance/service-accounts/default/token";

    #[test]
    fn the_region_is_the_last_segment_of_the_metadata_value() {
        assert_eq!(
            region_name("projects/735499857017/regions/us-central1"),
            "us-central1"
        );
        assert_eq!(region_name("us-central1\n"), "us-central1");
    }

    #[tokio::test]
    async fn reads_project_and_region_with_the_metadata_header() {
        let server = MockServer::start().await;
        for (at, body) in [
            ("/project/project-id", "observ-ing"),
            ("/project/numeric-project-id", "735499857017"),
            (
                "/instance/region",
                "projects/735499857017/regions/us-central1",
            ),
        ] {
            Mock::given(method("GET"))
                .and(path(at))
                .and(header("Metadata-Flavor", "Google"))
                .respond_with(ResponseTemplate::new(200).set_body_string(body))
                .mount(&server)
                .await;
        }

        let client = Client::with_base_url(&server.uri());
        assert_eq!(client.project_id().await.unwrap(), "observ-ing");
        assert_eq!(client.project_number().await.unwrap(), "735499857017");
        assert_eq!(client.region().await.unwrap(), "us-central1");
    }

    #[tokio::test]
    async fn caches_the_access_token_until_near_expiry() {
        let server = MockServer::start().await;
        Mock::given(path(TOKEN_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "test-token",
                "expires_in": 3599,
                "token_type": "Bearer",
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = Client::with_base_url(&server.uri());
        assert_eq!(client.access_token().await.unwrap(), "test-token");
        assert_eq!(client.access_token().await.unwrap(), "test-token");
    }

    #[tokio::test]
    async fn a_token_without_an_expiry_is_fetched_again() {
        let server = MockServer::start().await;
        Mock::given(path(TOKEN_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "test-token",
            })))
            .expect(2)
            .mount(&server)
            .await;

        let client = Client::with_base_url(&server.uri());
        client.access_token().await.unwrap();
        client.access_token().await.unwrap();
    }

    #[tokio::test]
    async fn an_error_status_is_an_error() {
        let server = MockServer::start().await;
        Mock::given(path(TOKEN_PATH))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let client = Client::with_base_url(&server.uri());
        assert!(matches!(
            client.access_token().await,
            Err(Error::Status { status: 404, .. })
        ));
    }
}
