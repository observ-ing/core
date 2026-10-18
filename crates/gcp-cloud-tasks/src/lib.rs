//! Minimal Cloud Tasks client: create HTTP tasks from code running on Cloud
//! Run.
//!
//! Each task is an HTTP POST that Cloud Tasks delivers, retrying with backoff
//! until the target answers 2xx. It carries an OIDC token for the queue's
//! invoker account, so the target can be a private Cloud Run service
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
const METADATA_TOKEN_URL: &str =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Refresh a cached access token this long before it expires.
const TOKEN_EXPIRY_MARGIN: chrono::Duration = chrono::Duration::seconds(60);

/// A Cloud Tasks queue that this process adds tasks to.
pub struct Queue {
    http: reqwest::Client,
    /// `projects/{project}/locations/{location}/queues/{queue}`.
    name: String,
    /// Service account email whose OIDC token each task carries.
    invoker: String,
    token: Mutex<Option<AccessToken>>,
}

/// One HTTP POST for Cloud Tasks to deliver.
#[derive(Debug, Clone, Default)]
pub struct HttpTask {
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
    /// as failed and retrying. `None` keeps the default of 10 minutes.
    pub dispatch_deadline: Option<Duration>,
}

/// Outcome of [`Queue::create`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Created {
    New,
    /// A task with this ID exists or ran recently. For a deduplication key
    /// this counts as success: that task covers the request.
    AlreadyExists,
}

#[derive(Debug)]
pub enum Error {
    /// The metadata server didn't hand out an access token.
    Token(String),
    Http(reqwest::Error),
    /// Cloud Tasks answered with an error.
    Api {
        status: u16,
        body: String,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Token(message) => write!(f, "could not get an access token: {message}"),
            Error::Http(e) => write!(f, "Cloud Tasks request failed: {e}"),
            Error::Api { status, body } => write!(f, "Cloud Tasks returned {status}: {body}"),
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

impl Queue {
    pub fn new(name: impl Into<String>, invoker: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("reqwest client builds with a timeout"),
            name: name.into(),
            invoker: invoker.into(),
            token: Mutex::new(None),
        }
    }

    /// From `CLOUD_TASKS_QUEUE` (the full queue name) and
    /// `CLOUD_TASKS_INVOKER` (the invoker's email). `None` unless both are
    /// set; blank values count as unset.
    pub fn from_env() -> Option<Self> {
        let (name, invoker) = Self::vars(
            std::env::var("CLOUD_TASKS_QUEUE").ok(),
            std::env::var("CLOUD_TASKS_INVOKER").ok(),
        )?;
        Some(Self::new(name, invoker))
    }

    fn vars(name: Option<String>, invoker: Option<String>) -> Option<(String, String)> {
        let set = |value: Option<String>| {
            value
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        Some((set(name)?, set(invoker)?))
    }

    /// The queue's full name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Add a task to the queue.
    pub async fn create(&self, task: &HttpTask) -> Result<Created, Error> {
        let token = self.access_token().await?;
        let response = self
            .http
            .post(format!("{API_BASE}/{}/tasks", self.name))
            .bearer_auth(token)
            .json(&task_json(&self.name, &self.invoker, task))
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(Created::New);
        }
        if status == reqwest::StatusCode::CONFLICT {
            return Ok(Created::AlreadyExists);
        }
        Err(Error::Api {
            status: status.as_u16(),
            body: response.text().await.unwrap_or_default(),
        })
    }

    async fn access_token(&self) -> Result<String, Error> {
        let mut cached = self.token.lock().await;
        if let Some(token) = cached.as_ref() {
            if Utc::now() + TOKEN_EXPIRY_MARGIN < token.expires_at {
                return Ok(token.value.clone());
            }
        }
        let response = self
            .http
            .get(METADATA_TOKEN_URL)
            .header("Metadata-Flavor", "Google")
            .send()
            .await
            .map_err(|e| Error::Token(e.to_string()))?;
        if !response.status().is_success() {
            return Err(Error::Token(format!(
                "metadata server returned {}",
                response.status()
            )));
        }
        let token: MetadataToken = response
            .json()
            .await
            .map_err(|e| Error::Token(e.to_string()))?;
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

/// A task ID shared by every request in the same `bucket` (for example, the
/// same minute), so Cloud Tasks keeps only the first.
///
/// IDs that sort in sequence, like timestamps, slow Cloud Tasks down, so the
/// ID starts with a hash of the bucket.
pub fn bucketed_task_id(prefix: &str, bucket: i64) -> String {
    format!("{:08x}-{prefix}-{bucket}", fnv1a(&bucket.to_le_bytes()))
}

/// 32-bit FNV-1a. Stable across builds, unlike `DefaultHasher`, so two
/// processes agree on a bucket's ID.
fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c_9dc5, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUEUE: &str = "projects/p/locations/us-central1/queues/q";

    fn some(value: &str) -> Option<String> {
        Some(value.to_string())
    }

    #[test]
    fn queue_needs_both_the_name_and_the_invoker() {
        assert_eq!(Queue::vars(None, None), None);
        assert_eq!(Queue::vars(some(QUEUE), None), None);
        assert_eq!(Queue::vars(some(QUEUE), some("  ")), None);
        assert_eq!(
            Queue::vars(some(QUEUE), some(" invoker@p.iam.gserviceaccount.com ")),
            Some((
                QUEUE.to_string(),
                "invoker@p.iam.gserviceaccount.com".to_string()
            ))
        );
    }

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

    #[test]
    fn bucketed_ids_are_stable_and_differ_by_bucket() {
        let id = bucketed_task_id("resolve-taxa", 29_000_000);
        assert_eq!(id, bucketed_task_id("resolve-taxa", 29_000_000));
        assert!(id.ends_with("-resolve-taxa-29000000"));
        assert_ne!(
            id[..8],
            bucketed_task_id("resolve-taxa", 29_000_001)[..8],
            "neighboring buckets should not share a prefix"
        );
    }
}
