//! Asks observing-resolve-taxa for a walk after an unresolved identification
//! lands.
//!
//! Every identification written in one minute shares one walk, at the start
//! of the next minute. This process asks once per minute, and on Cloud Tasks
//! the task's ID is the minute ([`gcp_cloud_tasks::bucketed_task_id`]), so a
//! second ingester instance during a deploy doesn't double it up either.
//!
//! - `RESOLVE_TAXA_URL` plus `CLOUD_TASKS_QUEUE` and `CLOUD_TASKS_INVOKER`
//!   (production): queue a Cloud Task for the service.
//! - `RESOLVE_TAXA_URL` alone (local development): wait for the minute, then
//!   POST to the service directly.
//! - Neither: do nothing. Rows stay unresolved until a walk runs some other
//!   way.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use gcp_cloud_tasks::{bucketed_task_id, HttpTask, Queue};
use tracing::{info, warn};

/// How long Cloud Tasks waits on a walk. Matches the continuation deadline
/// in observing-resolve-taxa.
const DISPATCH_DEADLINE: Duration = Duration::from_secs(15 * 60);

/// No minute has been asked for yet, or the last request failed.
const NO_MINUTE: i64 = i64::MIN;

#[derive(Clone)]
pub struct ResolveTaxaTrigger {
    inner: Option<Arc<Inner>>,
}

struct Inner {
    /// Base URL of observing-resolve-taxa.
    service_url: String,
    /// Where tasks go. `None` calls the service directly.
    queue: Option<Queue>,
    http: reqwest::Client,
    /// The last minute a walk was asked for.
    requested_minute: AtomicI64,
}

impl ResolveTaxaTrigger {
    pub fn from_env() -> Self {
        let service_url = std::env::var("RESOLVE_TAXA_URL")
            .ok()
            .map(|url| url.trim().trim_end_matches('/').to_string())
            .filter(|url| !url.is_empty());
        let Some(service_url) = service_url else {
            info!("RESOLVE_TAXA_URL unset; not asking for taxon resolution");
            return Self { inner: None };
        };
        let queue = Queue::from_env();
        match &queue {
            Some(queue) => info!(
                service = %service_url,
                queue = queue.name(),
                "Asking for taxon resolution through Cloud Tasks"
            ),
            None => info!(service = %service_url, "Asking for taxon resolution directly"),
        }
        Self {
            inner: Some(Arc::new(Inner {
                service_url,
                queue,
                http: reqwest::Client::new(),
                requested_minute: AtomicI64::new(NO_MINUTE),
            })),
        }
    }

    /// Ask for a walk at the start of the next minute, unless one has been
    /// asked for already. Never blocks: safe on the firehose hot path. Call it
    /// after the identification write commits.
    pub fn request(&self) {
        let Some(inner) = &self.inner else {
            return;
        };
        let minute = Utc::now().timestamp().div_euclid(60);
        if inner.requested_minute.swap(minute, Ordering::SeqCst) == minute {
            return;
        }
        let inner = Arc::clone(inner);
        tokio::spawn(async move {
            if let Err(e) = inner.ask(minute).await {
                warn!(error = %e, "Failed to ask for taxon resolution");
                // Let the next identification this minute try again.
                let _ = inner.requested_minute.compare_exchange(
                    minute,
                    NO_MINUTE,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                );
            }
        });
    }
}

impl Inner {
    async fn ask(&self, minute: i64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let run_at = DateTime::from_timestamp((minute + 1) * 60, 0).ok_or("minute out of range")?;
        let url = format!("{}/run", self.service_url);
        match &self.queue {
            Some(queue) => {
                let task = HttpTask {
                    id: Some(bucketed_task_id("resolve-taxa", minute)),
                    url,
                    audience: self.service_url.clone(),
                    body: None,
                    schedule_time: Some(run_at),
                    dispatch_deadline: Some(DISPATCH_DEADLINE),
                };
                queue.create(&task).await?;
            }
            None => {
                let wait = (run_at - Utc::now()).to_std().unwrap_or_default();
                tokio::time::sleep(wait).await;
                self.http.post(url).send().await?.error_for_status()?;
            }
        }
        Ok(())
    }
}
