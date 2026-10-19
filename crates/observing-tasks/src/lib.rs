//! Background tasks: the registry of them ([`Task`]) and a handle for queuing
//! runs ([`Tasks`]).
//!
//! Each task is a POST endpoint on its own Cloud Run service. Where a run goes
//! depends on where this process is:
//!
//! - **On Cloud Run** (`K_SERVICE` is set): a Cloud Task on the queue named
//!   after the task, carrying an OIDC token for `cloud-tasks-invoker`, to the
//!   service's URL. The project, region and URL come from the metadata
//!   server and Cloud Run's URL format, so nothing needs configuring.
//! - **Elsewhere** (local development): a POST to the service on localhost
//!   at the scheduled time, from a background task in this process.
//! - **`OBSERVING_TASKS=off`**: nowhere.

mod cloud_tasks;
mod registry;

use std::fmt;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use cloud_tasks::HttpTask;
use serde_json::Value;
use tracing::{info, warn};

pub use registry::{Task, WORKER_SERVICE};

/// The account Cloud Tasks calls services as.
const INVOKER_ACCOUNT: &str = "cloud-tasks-invoker";

#[derive(Debug)]
pub enum Error {
    /// The metadata server didn't answer, so there is no project, region or
    /// access token to queue with.
    Metadata(gcp_metadata::Error),
    Http(reqwest::Error),
    /// Cloud Tasks, or a task's service in local development, answered with
    /// an error.
    Api {
        status: u16,
        body: String,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Metadata(e) => e.fmt(f),
            Error::Http(e) => write!(f, "request failed: {e}"),
            Error::Api { status, body } => write!(f, "returned {status}: {body}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Metadata(e) => Some(e),
            Error::Http(e) => Some(e),
            Error::Api { .. } => None,
        }
    }
}

impl From<gcp_metadata::Error> for Error {
    fn from(e: gcp_metadata::Error) -> Self {
        Error::Metadata(e)
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Http(e)
    }
}

/// One run to queue.
#[derive(Debug, Clone, Default)]
pub struct Run {
    /// Deduplication key: a second run with the same ID within about an hour
    /// is dropped. Only Cloud Tasks honors it.
    pub id: Option<String>,
    /// JSON body. `None` sends an empty body.
    pub body: Option<Value>,
    /// When to run. `None` runs right away.
    pub at: Option<DateTime<Utc>>,
}

pub struct Tasks {
    backend: Backend,
}

enum Backend {
    CloudTasks {
        metadata: gcp_metadata::Client,
        client: cloud_tasks::Client,
        project_id: String,
        project_number: String,
        region: String,
    },
    Local {
        http: reqwest::Client,
    },
    Off,
}

impl Tasks {
    /// Pick the backend for where this process is running. On Cloud Run this
    /// asks the metadata server for the project and region.
    pub async fn from_env() -> Result<Self, Error> {
        let setting = std::env::var("OBSERVING_TASKS").unwrap_or_default();
        if setting.trim().eq_ignore_ascii_case("off") {
            info!("OBSERVING_TASKS=off; not queuing background tasks");
            return Ok(Self::off());
        }
        if std::env::var_os("K_SERVICE").is_none() {
            info!("Not on Cloud Run; background tasks go straight to localhost");
            return Ok(Self {
                backend: Backend::Local {
                    http: reqwest::Client::new(),
                },
            });
        }

        let metadata = gcp_metadata::Client::new();
        let project_id = metadata.project_id().await?;
        let project_number = metadata.project_number().await?;
        let region = metadata.region().await?;
        info!(project = %project_id, region = %region, "Background tasks go to Cloud Tasks");
        Ok(Self {
            backend: Backend::CloudTasks {
                metadata,
                client: cloud_tasks::Client::new(),
                project_id,
                project_number,
                region,
            },
        })
    }

    pub fn off() -> Self {
        Self {
            backend: Backend::Off,
        }
    }

    /// Whether runs go through Cloud Tasks, which retries them and holds
    /// them until their time comes even if this process stops.
    pub fn is_cloud_tasks(&self) -> bool {
        matches!(self.backend, Backend::CloudTasks { .. })
    }

    /// Base URL of the task's service. `None` when tasks are off.
    pub fn url(&self, task: Task) -> Option<String> {
        match &self.backend {
            Backend::CloudTasks {
                project_number,
                region,
                ..
            } => Some(cloud_run_url(task.service(), project_number, region)),
            Backend::Local { .. } => {
                let port = std::env::var(task.port_env())
                    .ok()
                    .and_then(|p| p.trim().parse().ok())
                    .unwrap_or(task.local_port());
                Some(format!("http://localhost:{port}"))
            }
            Backend::Off => None,
        }
    }

    /// Queue a run of `task`.
    ///
    /// Locally, the run is POSTed from a background task once its time comes,
    /// and a failure there is only logged: this returns `Ok` as soon as the
    /// run is scheduled.
    pub async fn enqueue(&self, task: Task, run: Run) -> Result<(), Error> {
        let Some(base) = self.url(task) else {
            return Ok(());
        };
        let url = format!("{base}{}", task.path());
        match &self.backend {
            Backend::CloudTasks {
                metadata,
                client,
                project_id,
                region,
                ..
            } => {
                let queue = format!(
                    "projects/{project_id}/locations/{region}/queues/{}",
                    task.name()
                );
                let invoker = format!("{INVOKER_ACCOUNT}@{project_id}.iam.gserviceaccount.com");
                let http_task = HttpTask {
                    id: run.id,
                    url,
                    audience: base,
                    body: run.body,
                    schedule_time: run.at,
                    dispatch_deadline: Some(task.dispatch_deadline()),
                };
                let access_token = metadata.access_token().await?;
                client
                    .create(&access_token, &queue, &invoker, &http_task)
                    .await
            }
            Backend::Local { http } => {
                let http = http.clone();
                tokio::spawn(async move {
                    if let Some(at) = run.at {
                        let wait = (at - Utc::now()).to_std().unwrap_or_default();
                        tokio::time::sleep(wait).await;
                    }
                    let mut request = http.post(&url);
                    if let Some(body) = &run.body {
                        request = request.json(body);
                    }
                    let result = match request.send().await {
                        Ok(response) if !response.status().is_success() => Err(Error::Api {
                            status: response.status().as_u16(),
                            body: response.text().await.unwrap_or_default(),
                        }),
                        Ok(_) => Ok(()),
                        Err(e) => Err(Error::Http(e)),
                    };
                    if let Err(e) = result {
                        warn!(task = task.name(), url = %url, error = %e, "Local task run failed");
                    }
                });
                Ok(())
            }
            Backend::Off => Ok(()),
        }
    }

    /// A handle that coalesces requests for `task` into one run per
    /// [`Task::window`].
    pub fn trigger(self: &Arc<Self>, task: Task) -> Trigger {
        Trigger {
            tasks: Arc::clone(self),
            task,
            requested_window: Arc::new(AtomicI64::new(NO_WINDOW)),
        }
    }
}

/// No window has been asked for yet, or the last request failed.
const NO_WINDOW: i64 = i64::MIN;

/// Asks for a run of one task at the end of the current window, at most once
/// per window. Cheap to clone; clones share the window.
#[derive(Clone)]
pub struct Trigger {
    tasks: Arc<Tasks>,
    task: Task,
    requested_window: Arc<AtomicI64>,
}

impl Trigger {
    /// Ask for a run at the end of the current window, unless one has been
    /// asked for already. Never blocks: safe on a hot path.
    ///
    /// On Cloud Tasks the run's ID is the window, so other processes asking
    /// in the same window share the run too.
    pub fn request(&self) {
        if matches!(self.tasks.backend, Backend::Off) {
            return;
        }
        let window_secs = self.task.window().as_secs() as i64;
        let window = Utc::now().timestamp().div_euclid(window_secs);
        if self.requested_window.swap(window, Ordering::SeqCst) == window {
            return;
        }
        let this = self.clone();
        tokio::spawn(async move {
            let run = Run {
                id: Some(window_task_id(this.task.name(), window)),
                body: None,
                at: DateTime::from_timestamp((window + 1) * window_secs, 0),
            };
            if let Err(e) = this.tasks.enqueue(this.task, run).await {
                warn!(task = this.task.name(), error = %e, "Failed to queue a task run");
                // Let the next request this window try again.
                let _ = this.requested_window.compare_exchange(
                    window,
                    NO_WINDOW,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                );
            }
        });
    }
}

/// Cloud Run's deterministic service URL.
fn cloud_run_url(service: &str, project_number: &str, region: &str) -> String {
    format!("https://{service}-{project_number}.{region}.run.app")
}

/// A task ID for one window. IDs that sort in sequence, like timestamps, slow
/// Cloud Tasks down, so it starts with a hash of the window.
fn window_task_id(name: &str, window: i64) -> String {
    format!("{:08x}-{name}-{window}", fnv1a(&window.to_le_bytes()))
}

/// 32-bit FNV-1a. Stable across builds, unlike `DefaultHasher`, so two
/// processes agree on a window's ID.
fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c_9dc5, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn cloud_run_urls_use_the_deterministic_format() {
        assert_eq!(
            cloud_run_url("observing-worker", "735499857017", "us-central1"),
            "https://observing-worker-735499857017.us-central1.run.app"
        );
    }

    #[test]
    fn window_ids_are_stable_and_differ_by_window() {
        let id = window_task_id("resolve-taxa", 29_000_000);
        assert_eq!(id, window_task_id("resolve-taxa", 29_000_000));
        assert!(id.ends_with("-resolve-taxa-29000000"));
        assert_ne!(
            id[..8],
            window_task_id("resolve-taxa", 29_000_001)[..8],
            "neighboring windows should not share a prefix"
        );
    }

    #[test]
    fn tasks_that_are_off_have_no_url() {
        assert_eq!(Tasks::off().url(Task::ResolveTaxa), None);
    }

    #[tokio::test]
    async fn a_local_run_posts_its_body_to_the_service() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // The only test that reads this variable.
        std::env::set_var(Task::ResolveTaxa.port_env(), port.to_string());

        let tasks = Tasks {
            backend: Backend::Local {
                http: reqwest::Client::new(),
            },
        };
        assert_eq!(
            tasks.url(Task::ResolveTaxa),
            Some(format!("http://localhost:{port}"))
        );
        let run = Run {
            body: Some(serde_json::json!({ "phase": "names" })),
            ..Default::default()
        };
        tasks.enqueue(Task::ResolveTaxa, run).await.unwrap();

        let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .expect("the run arrives")
            .unwrap();
        let mut request = Vec::new();
        let mut buf = [0u8; 1024];
        while !String::from_utf8_lossy(&request).ends_with(r#"{"phase":"names"}"#) {
            let n = socket.read(&mut buf).await.unwrap();
            assert!(n > 0, "connection closed early");
            request.extend_from_slice(&buf[..n]);
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n")
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&request).starts_with("POST /tasks/resolve-taxa HTTP/1.1"));
    }
}
