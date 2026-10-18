//! Minimal Cloud Tasks client, plus the metadata-server lookups it needs.
//!
//! Each task is an HTTP POST that Cloud Tasks delivers, retrying with backoff
//! until the target answers 2xx. It carries an OIDC token for an invoker
//! account, so the target can be a private Cloud Run service
//! (`--no-allow-unauthenticated`) whose own IAM check does the
//! authentication.
//!
//! The caller authenticates as its own service account, with an access token
//! from the metadata server, so this only works on GCP. That is one REST call
//! and no Google SDK.

use std::fmt;
use std::time::Duration;

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

const API_BASE: &str = "https://cloudtasks.googleapis.com/v2";
const METADATA_BASE: &str = "http://metadata.google.internal/computeMetadata/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Refresh a cached access token this long before it expires.
const TOKEN_EXPIRY_MARGIN: chrono::Duration = chrono::Duration::seconds(60);

pub(crate) struct Client {
    http: reqwest::Client,
    token: Mutex<Option<AccessToken>>,
}

/// One HTTP POST for Cloud Tasks to deliver.
#[derive(Debug, Clone, Default)]
pub(crate) struct HttpTask {
    /// Task ID, unique within the queue. Cloud Tasks refuses a second task
    /// with the same ID for about an hour after the first runs, which makes a
    /// fixed ID a deduplication key. `None` lets Cloud Tasks pick one.
    pub id: Option<String>,
    pub url: String,
    /// Audience of the OIDC token. For a Cloud Run target, its service URL.
    pub audience: String,
    /// JSON body. `None` sends an empty body.
    pub body: Option<Value>,
    /// When to deliver. `None` delivers right away.
    pub schedule_time: Option<DateTime<Utc>>,
    /// How long Cloud Tasks waits for a response before counting the attempt
    /// as failed and retrying.
    pub dispatch_deadline: Option<Duration>,
}

#[derive(Debug)]
pub enum Error {
    /// The metadata server didn't answer.
    Metadata(String),
    Http(reqwest::Error),
    /// Cloud Tasks, or a task's target in local development, answered with
    /// an error.
    Api {
        status: u16,
        body: String,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Metadata(message) => write!(f, "metadata server: {message}"),
            Error::Http(e) => write!(f, "request failed: {e}"),
            Error::Api { status, body } => write!(f, "returned {status}: {body}"),
        }
    }
}

impl std::error::Error for Error {}

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
    expires_in: i64,
}

impl Client {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("reqwest client builds with a timeout"),
            token: Mutex::new(None),
        }
    }

    /// Add a task to `queue` (`projects/{p}/locations/{l}/queues/{q}`),
    /// carrying an OIDC token for `invoker`. A task whose ID exists or ran
    /// recently counts as success: that task covers the request.
    pub async fn create(&self, queue: &str, invoker: &str, task: &HttpTask) -> Result<(), Error> {
        let token = self.access_token().await?;
        let response = self
            .http
            .post(format!("{API_BASE}/{queue}/tasks"))
            .bearer_auth(token)
            .json(&task_json(queue, invoker, task))
            .send()
            .await?;
        let status = response.status();
        if status.is_success() || status == reqwest::StatusCode::CONFLICT {
            return Ok(());
        }
        Err(Error::Api {
            status: status.as_u16(),
            body: response.text().await.unwrap_or_default(),
        })
    }

    /// A value from the metadata server, e.g. `project/project-id`.
    pub async fn metadata(&self, path: &str) -> Result<String, Error> {
        let response = self
            .http
            .get(format!("{METADATA_BASE}/{path}"))
            .header("Metadata-Flavor", "Google")
            .send()
            .await
            .map_err(|e| Error::Metadata(e.to_string()))?;
        if !response.status().is_success() {
            return Err(Error::Metadata(format!(
                "{path} returned {}",
                response.status()
            )));
        }
        response
            .text()
            .await
            .map_err(|e| Error::Metadata(e.to_string()))
    }

    async fn access_token(&self) -> Result<String, Error> {
        let mut cached = self.token.lock().await;
        if let Some(token) = cached.as_ref() {
            if Utc::now() + TOKEN_EXPIRY_MARGIN < token.expires_at {
                return Ok(token.value.clone());
            }
        }
        let body = self
            .metadata("instance/service-accounts/default/token")
            .await?;
        let token: MetadataToken =
            serde_json::from_str(&body).map_err(|e| Error::Metadata(e.to_string()))?;
        let value = token.access_token;
        *cached = Some(AccessToken {
            value: value.clone(),
            expires_at: Utc::now() + chrono::Duration::seconds(token.expires_in),
        });
        Ok(value)
    }
}

/// The `CreateTask` request body.
fn task_json(queue: &str, invoker: &str, task: &HttpTask) -> Value {
    let mut http_request = json!({
        "url": task.url,
        "httpMethod": "POST",
        "oidcToken": {
            "serviceAccountEmail": invoker,
            "audience": task.audience,
        },
    });
    if let Some(body) = &task.body {
        http_request["headers"] = json!({ "Content-Type": "application/json" });
        http_request["body"] =
            Value::String(base64::engine::general_purpose::STANDARD.encode(body.to_string()));
    }

    let mut inner = json!({ "httpRequest": http_request });
    if let Some(id) = &task.id {
        inner["name"] = Value::String(format!("{queue}/tasks/{id}"));
    }
    if let Some(at) = task.schedule_time {
        inner["scheduleTime"] = Value::String(at.to_rfc3339());
    }
    if let Some(deadline) = task.dispatch_deadline {
        inner["dispatchDeadline"] = Value::String(format!("{}s", deadline.as_secs()));
    }
    json!({ "task": inner })
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUEUE: &str = "projects/p/locations/us-central1/queues/q";

    #[test]
    fn a_bare_task_is_an_immediate_post_with_an_oidc_token() {
        let task = HttpTask {
            url: "https://svc.run.app/run".into(),
            audience: "https://svc.run.app".into(),
            ..Default::default()
        };
        assert_eq!(
            task_json(QUEUE, "invoker@p", &task),
            json!({
                "task": {
                    "httpRequest": {
                        "url": "https://svc.run.app/run",
                        "httpMethod": "POST",
                        "oidcToken": {
                            "serviceAccountEmail": "invoker@p",
                            "audience": "https://svc.run.app",
                        },
                    },
                },
            })
        );
    }

    #[test]
    fn a_full_task_is_named_scheduled_and_carries_a_json_body() {
        let task = HttpTask {
            id: Some("abc".into()),
            url: "https://svc.run.app/run".into(),
            audience: "https://svc.run.app".into(),
            body: Some(json!({ "phase": "names" })),
            schedule_time: Some(
                DateTime::parse_from_rfc3339("2026-10-18T12:01:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            ),
            dispatch_deadline: Some(Duration::from_secs(900)),
        };
        let body = task_json(QUEUE, "invoker@p", &task);
        let inner = &body["task"];
        assert_eq!(inner["name"], format!("{QUEUE}/tasks/abc"));
        assert_eq!(inner["scheduleTime"], "2026-10-18T12:01:00+00:00");
        assert_eq!(inner["dispatchDeadline"], "900s");
        assert_eq!(
            inner["httpRequest"]["headers"]["Content-Type"],
            "application/json"
        );
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(inner["httpRequest"]["body"].as_str().unwrap())
            .unwrap();
        assert_eq!(decoded, br#"{"phase":"names"}"#);
    }
}
