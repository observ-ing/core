use reqwest::Client;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub use observing_species_id_protocol::{IdentifyRequest, IdentifyResponse};

/// How long `/identify` may take end to end. The species-id services scale to
/// zero, so a request can land on a cold instance and wait for it to boot
/// (~20s for ViT-H on gen2) before inference even starts. Generous enough to
/// cover a slow boot; Cloud Run queues the request until the instance is up.
const IDENTIFY_TIMEOUT: Duration = Duration::from_secs(120);

/// How long `/health` gets before we call the service cold. A warm instance
/// answers in well under 100ms, so anything slower means Cloud Run is holding
/// the request while it boots one. The abandoned probe still triggers that
/// boot, which is what makes `status()` double as a pre-warm.
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// Floor on the reported remaining boot time, so a boot that's running a bit
/// over its estimate still shows a short wait rather than "0 seconds".
const MIN_REMAINING: Duration = Duration::from_secs(3);

/// A tracked boot this far past its estimate is assumed to have been
/// abandoned (e.g. the instance started and has since scaled back to zero),
/// so the next cold probe starts a fresh countdown.
const STALE_BOOT_GRACE: Duration = Duration::from_secs(60);

/// Warm/cold state of a species-id service, as reported to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesIdStatus {
    pub ready: bool,
    /// Rough seconds until an identify request would complete, when cold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_seconds: Option<u64>,
}

/// HTTP client for the species identification service
pub struct SpeciesIdClient {
    client: Client,
    base_url: String,
    /// Typical time from a cold probe to an identify response (boot +
    /// first inference).
    cold_start_estimate: Duration,
    /// When we first saw the service cold, so repeated status checks (from
    /// the same or other users) count down instead of restarting the clock.
    cold_since: Mutex<Option<Instant>>,
}

impl SpeciesIdClient {
    pub fn new(base_url: &str, cold_start_estimate: Duration) -> Self {
        let client = Client::builder()
            .timeout(IDENTIFY_TIMEOUT)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.to_string(),
            cold_start_estimate,
            cold_since: Mutex::new(None),
        }
    }

    /// Identify species from a base64-encoded image.
    ///
    /// Errors are propagated to the caller (network failure, non-2xx status
    /// from the upstream service, or JSON decode failure) so the route can
    /// log them with full context instead of collapsing everything into a
    /// generic `None`.
    pub async fn identify(
        &self,
        image_base64: &str,
        latitude: Option<f64>,
        longitude: Option<f64>,
        limit: Option<usize>,
    ) -> Result<IdentifyResponse, reqwest::Error> {
        let url = format!("{}/identify", self.base_url);

        let body = IdentifyRequest {
            image: image_base64.to_string(),
            latitude,
            longitude,
            limit: limit.unwrap_or(5),
        };

        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await;
        if response.is_ok() {
            self.mark_warm();
        }
        response
    }

    /// Probe whether the service has a warm instance. When it doesn't, the
    /// probe itself makes Cloud Run start booting one, so callers use this
    /// to pre-warm the service ahead of an identify request.
    pub async fn status(&self) -> SpeciesIdStatus {
        let sent = Instant::now();
        let warm = self
            .client
            .get(format!("{}/health", self.base_url))
            .timeout(PROBE_TIMEOUT)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success());

        if warm {
            self.mark_warm();
            return SpeciesIdStatus {
                ready: true,
                estimated_seconds: None,
            };
        }
        let remaining = self.remaining_boot_time(sent, Instant::now());
        SpeciesIdStatus {
            ready: false,
            estimated_seconds: Some(remaining.as_secs()),
        }
    }

    fn mark_warm(&self) {
        *self.cold_since.lock().expect("cold_since lock poisoned") = None;
    }

    /// Record that a probe sent at `sent` found the service cold, and return
    /// how much of the boot is likely left at `now`. The boot started when
    /// the probe was sent (that request is what woke the service), unless an
    /// earlier probe already started one that's still in progress.
    fn remaining_boot_time(&self, sent: Instant, now: Instant) -> Duration {
        let mut cold_since = self.cold_since.lock().expect("cold_since lock poisoned");
        let started = match *cold_since {
            Some(t) if now - t <= self.cold_start_estimate + STALE_BOOT_GRACE => t,
            _ => {
                *cold_since = Some(sent);
                sent
            }
        };
        self.cold_start_estimate
            .saturating_sub(now - started)
            .max(MIN_REMAINING)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const ESTIMATE: Duration = Duration::from_secs(25);

    #[test]
    fn countdown_continues_across_cold_observations() {
        let client = SpeciesIdClient::new("http://unused", ESTIMATE);
        let t0 = Instant::now();

        assert_eq!(client.remaining_boot_time(t0, t0), Duration::from_secs(25));
        // A later probe (e.g. from another user) continues the same boot.
        let t10 = t0 + Duration::from_secs(10);
        assert_eq!(
            client.remaining_boot_time(t10, t10),
            Duration::from_secs(15)
        );
    }

    #[test]
    fn countdown_starts_when_probe_was_sent() {
        let client = SpeciesIdClient::new("http://unused", ESTIMATE);
        let sent = Instant::now();

        // The probe timed out 1.5s after it woke the service.
        let answered = sent + Duration::from_millis(1500);
        assert_eq!(
            client.remaining_boot_time(sent, answered),
            Duration::from_millis(23_500)
        );
    }

    #[test]
    fn countdown_floors_when_boot_overruns() {
        let client = SpeciesIdClient::new("http://unused", ESTIMATE);
        let t0 = Instant::now();

        client.remaining_boot_time(t0, t0);
        let t40 = t0 + Duration::from_secs(40);
        assert_eq!(client.remaining_boot_time(t40, t40), MIN_REMAINING);
    }

    #[test]
    fn stale_boot_restarts_countdown() {
        let client = SpeciesIdClient::new("http://unused", ESTIMATE);
        let t0 = Instant::now();

        client.remaining_boot_time(t0, t0);
        let later = t0 + ESTIMATE + STALE_BOOT_GRACE + Duration::from_secs(1);
        assert_eq!(client.remaining_boot_time(later, later), ESTIMATE);
    }

    #[test]
    fn warm_resets_countdown() {
        let client = SpeciesIdClient::new("http://unused", ESTIMATE);
        let t0 = Instant::now();

        client.remaining_boot_time(t0, t0);
        client.mark_warm();
        let t10 = t0 + Duration::from_secs(10);
        assert_eq!(client.remaining_boot_time(t10, t10), ESTIMATE);
    }

    #[tokio::test]
    async fn status_ready_when_health_answers() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/health"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        let client = SpeciesIdClient::new(&server.uri(), ESTIMATE);

        assert_eq!(
            client.status().await,
            SpeciesIdStatus {
                ready: true,
                estimated_seconds: None
            }
        );
    }

    #[tokio::test]
    async fn status_cold_when_health_is_slow() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/health"))
            .respond_with(ResponseTemplate::new(200).set_delay(PROBE_TIMEOUT * 2))
            .mount(&server)
            .await;
        let client = SpeciesIdClient::new(&server.uri(), ESTIMATE);

        let status = client.status().await;

        assert!(!status.ready);
        // The countdown starts when the probe was sent, so the ~1.5s it
        // spent timing out is already deducted.
        let secs = status.estimated_seconds.unwrap();
        assert!((22..=23).contains(&secs), "estimated_seconds = {secs}");
    }
}
