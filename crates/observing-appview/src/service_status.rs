//! Public status of the production services: whether each Cloud Run service
//! is awake or asleep and how many instances it's running, plus whether the
//! database is up. Read from Cloud Monitoring, the same metrics as the
//! internal dashboard in `infra/monitoring/service-status-dashboard.json`.

use std::collections::HashMap;
use std::fmt;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use utoipa::ToSchema;

/// How long a status read is reused. Cloud Run samples instance counts once a
/// minute, so reading more often than this wouldn't show anything new.
const CACHE_TTL: Duration = Duration::from_secs(60);

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Instances per service, split into those handling a request (`active`) and
/// those waiting for one (`idle`). A service that has scaled to zero stops
/// reporting a few minutes later, so it's simply missing from the result.
const INSTANCES_QUERY: &str = r#"sum by (service_name, state) (run_googleapis_com:container_instance_count{monitored_resource="cloud_run_revision"})"#;

/// 1 while the Cloud SQL instance is up.
const DATABASE_UP_QUERY: &str =
    r#"min(cloudsql_googleapis_com:database_up{monitored_resource="cloudsql_database"})"#;

/// A Cloud Run service shown on the status page. Only these are reported, so
/// one-off services in the project (e.g. throwaway benchmarks) stay private.
struct ServiceInfo {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    /// Configured to never scale to zero, so 0 instances means it's down
    /// rather than asleep.
    always_on: bool,
}

const SERVICES: &[ServiceInfo] = &[
    ServiceInfo {
        id: "observing-appview",
        name: "Website & API",
        description: "Serves this site and the API behind it.",
        always_on: false,
    },
    ServiceInfo {
        id: "tap-ingester",
        name: "Ingester",
        description: "Reads new observations, identifications and comments from the AT Protocol network into the index.",
        always_on: true,
    },
    ServiceInfo {
        id: "observing-species-id",
        name: "Species ID",
        description: "Suggests species for photos you upload.",
        always_on: false,
    },
    ServiceInfo {
        id: "observing-species-id-live",
        name: "Live camera ID",
        description: "Suggests species from the live camera view, using a smaller, faster model.",
        always_on: false,
    },
    ServiceInfo {
        id: "observing-worker",
        name: "Background tasks",
        description: "Matches new identifications to the GBIF taxonomy, a minute after they arrive, and posts observations to iNaturalist when their owners ask.",
        always_on: false,
    },
    ServiceInfo {
        id: "storybook",
        name: "Storybook",
        description: "The interactive component library.",
        always_on: false,
    },
];

const DATABASE: ServiceInfo = ServiceInfo {
    id: "observing-db",
    name: "Database",
    description: "Stores the index of observations, identifications and profiles.",
    always_on: true,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    /// A scale-to-zero service has at least one instance running.
    Awake,
    /// A scale-to-zero service has no instances. The next request starts one.
    Asleep,
    /// An always-on service is running.
    Up,
    /// An always-on service has nothing running.
    Down,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    #[schema(example = "observing-species-id")]
    pub id: &'static str,
    #[schema(example = "Species ID")]
    pub name: &'static str,
    pub description: &'static str,
    pub state: ServiceState,
    /// Instances running. Absent for the database, which isn't a Cloud Run
    /// service.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instances: Option<u32>,
    /// Of `instances`, how many are handling a request right now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_instances: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatusResponse {
    pub services: Vec<ServiceStatus>,
    /// When the metrics were read. Cloud Run reports instance counts about
    /// three minutes after it samples them, so they trail this a little.
    pub checked_at: DateTime<Utc>,
}

/// Reads service status from Cloud Monitoring's PromQL API, authenticating
/// as the appview's own service account.
pub struct ServiceStatusClient {
    client: Client,
    /// Hands out the access token for Cloud Monitoring.
    metadata: gcp_metadata::Client,
    query_url: String,
    /// The last successful read. Held across the refresh so concurrent
    /// requests wait for one Monitoring call instead of each making their own.
    cached: Mutex<Option<(Instant, ServiceStatusResponse)>>,
}

impl ServiceStatusClient {
    pub fn new(project_id: &str) -> Self {
        Self::with_clients(
            gcp_metadata::Client::new(),
            &format!(
                "https://monitoring.googleapis.com/v1/projects/{project_id}/location/global/prometheus/api/v1/query"
            ),
        )
    }

    /// Construct a client with an arbitrary metadata server and query
    /// endpoint. Production uses the real metadata server and Cloud
    /// Monitoring; tests point both at a wiremock server.
    fn with_clients(metadata: gcp_metadata::Client, query_url: &str) -> Self {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            metadata,
            query_url: query_url.to_string(),
            cached: Mutex::new(None),
        }
    }

    pub async fn status(&self) -> Result<ServiceStatusResponse, StatusError> {
        let mut cached = self.cached.lock().await;
        if let Some((read_at, status)) = cached.as_ref() {
            if read_at.elapsed() < CACHE_TTL {
                return Ok(status.clone());
            }
        }

        let status = self.fetch().await?;
        *cached = Some((Instant::now(), status.clone()));
        Ok(status)
    }

    async fn fetch(&self) -> Result<ServiceStatusResponse, StatusError> {
        let token = self
            .metadata
            .access_token()
            .await
            .map_err(StatusError::Token)?;

        let (instances, database_up) = tokio::try_join!(
            self.query(&token, INSTANCES_QUERY),
            self.query(&token, DATABASE_UP_QUERY),
        )
        .map_err(StatusError::Monitoring)?;

        let instances = instances
            .iter()
            .filter_map(|sample| {
                Some(InstanceCount {
                    service: sample.metric.get("service_name")?,
                    active: sample.metric.get("state")? == "active",
                    count: sample.count(),
                })
            })
            .collect::<Vec<_>>();
        let database_up = database_up.first().is_some_and(|s| s.count() > 0);

        Ok(build_status(&instances, database_up, Utc::now()))
    }

    async fn query(&self, token: &str, promql: &str) -> Result<Vec<Sample>, reqwest::Error> {
        let response: QueryResponse = self
            .client
            .get(&self.query_url)
            .bearer_auth(token)
            .query(&[("query", promql)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(response.data.result)
    }
}

/// Why a status read failed.
#[derive(Debug)]
pub enum StatusError {
    /// The metadata server didn't hand out an access token.
    Token(gcp_metadata::Error),
    Monitoring(reqwest::Error),
}

impl fmt::Display for StatusError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StatusError::Token(e) => write!(f, "could not get an access token: {e}"),
            StatusError::Monitoring(e) => write!(f, "Cloud Monitoring request failed: {e}"),
        }
    }
}

impl std::error::Error for StatusError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StatusError::Token(e) => Some(e),
            StatusError::Monitoring(e) => Some(e),
        }
    }
}

/// A Prometheus instant-query response.
#[derive(Deserialize)]
struct QueryResponse {
    data: QueryData,
}

#[derive(Deserialize)]
struct QueryData {
    result: Vec<Sample>,
}

#[derive(Deserialize)]
struct Sample {
    metric: HashMap<String, String>,
    /// `[unix_seconds, "value"]`.
    value: (f64, String),
}

impl Sample {
    fn count(&self) -> u32 {
        self.value.1.parse::<f64>().map_or(0, |v| v.round() as u32)
    }
}

struct InstanceCount<'a> {
    service: &'a str,
    active: bool,
    count: u32,
}

fn build_status(
    instances: &[InstanceCount],
    database_up: bool,
    checked_at: DateTime<Utc>,
) -> ServiceStatusResponse {
    let mut services: Vec<ServiceStatus> = SERVICES
        .iter()
        .map(|info| {
            let counts = instances.iter().filter(|c| c.service == info.id);
            let total: u32 = counts.clone().map(|c| c.count).sum();
            let active: u32 = counts.filter(|c| c.active).map(|c| c.count).sum();
            ServiceStatus {
                id: info.id,
                name: info.name,
                description: info.description,
                state: state_for(info, total > 0),
                instances: Some(total),
                active_instances: Some(active),
            }
        })
        .collect();

    services.push(ServiceStatus {
        id: DATABASE.id,
        name: DATABASE.name,
        description: DATABASE.description,
        state: state_for(&DATABASE, database_up),
        instances: None,
        active_instances: None,
    });

    ServiceStatusResponse {
        services,
        checked_at,
    }
}

fn state_for(info: &ServiceInfo, running: bool) -> ServiceState {
    match (info.always_on, running) {
        (false, true) => ServiceState::Awake,
        (false, false) => ServiceState::Asleep,
        (true, true) => ServiceState::Up,
        (true, false) => ServiceState::Down,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn find<'a>(status: &'a ServiceStatusResponse, id: &str) -> &'a ServiceStatus {
        status.services.iter().find(|s| s.id == id).unwrap()
    }

    #[test]
    fn sums_instances_across_states() {
        let instances = [
            InstanceCount {
                service: "observing-appview",
                active: true,
                count: 1,
            },
            InstanceCount {
                service: "observing-appview",
                active: false,
                count: 2,
            },
        ];
        let status = build_status(&instances, true, Utc::now());

        let appview = find(&status, "observing-appview");
        assert_eq!(appview.state, ServiceState::Awake);
        assert_eq!(appview.instances, Some(3));
        assert_eq!(appview.active_instances, Some(1));
    }

    #[test]
    fn missing_service_is_asleep_with_zero_instances() {
        let status = build_status(&[], true, Utc::now());

        let live = find(&status, "observing-species-id-live");
        assert_eq!(live.state, ServiceState::Asleep);
        assert_eq!(live.instances, Some(0));
        assert_eq!(live.active_instances, Some(0));
    }

    #[test]
    fn idle_only_service_is_awake() {
        let instances = [InstanceCount {
            service: "observing-species-id",
            active: false,
            count: 1,
        }];
        let status = build_status(&instances, true, Utc::now());

        let species_id = find(&status, "observing-species-id");
        assert_eq!(species_id.state, ServiceState::Awake);
        assert_eq!(species_id.active_instances, Some(0));
    }

    #[test]
    fn always_on_service_without_instances_is_down() {
        let status = build_status(&[], true, Utc::now());
        assert_eq!(find(&status, "tap-ingester").state, ServiceState::Down);

        let instances = [InstanceCount {
            service: "tap-ingester",
            active: true,
            count: 1,
        }];
        let status = build_status(&instances, true, Utc::now());
        assert_eq!(find(&status, "tap-ingester").state, ServiceState::Up);
    }

    #[test]
    fn database_reports_up_or_down_without_instances() {
        let up = build_status(&[], true, Utc::now());
        let db = find(&up, "observing-db");
        assert_eq!(db.state, ServiceState::Up);
        assert_eq!(db.instances, None);

        let down = build_status(&[], false, Utc::now());
        assert_eq!(find(&down, "observing-db").state, ServiceState::Down);
    }

    #[test]
    fn unlisted_services_are_left_out() {
        let instances = [InstanceCount {
            service: "throwaway-benchmark",
            active: true,
            count: 4,
        }];
        let status = build_status(&instances, true, Utc::now());

        assert!(status
            .services
            .iter()
            .all(|s| s.id != "throwaway-benchmark"));
        assert_eq!(status.services.len(), SERVICES.len() + 1);
    }

    /// Where the metadata server hands out the access token.
    const TOKEN_PATH: &str = "/instance/service-accounts/default/token";

    fn vector(result: serde_json::Value) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "status": "success",
            "data": { "resultType": "vector", "result": result },
        }))
    }

    #[tokio::test]
    async fn reads_monitoring_with_metadata_token_and_caches() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(TOKEN_PATH))
            .and(header("Metadata-Flavor", "Google"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "test-token",
                "expires_in": 3599,
                "token_type": "Bearer",
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/query"))
            .and(header("Authorization", "Bearer test-token"))
            .and(query_param("query", INSTANCES_QUERY))
            .respond_with(vector(serde_json::json!([
                {"metric": {"service_name": "tap-ingester", "state": "active"}, "value": [1760196000.5, "1"]},
                {"metric": {"service_name": "observing-appview", "state": "idle"}, "value": [1760196000.5, "2"]},
            ])))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/query"))
            .and(query_param("query", DATABASE_UP_QUERY))
            .respond_with(vector(serde_json::json!([
                {"metric": {}, "value": [1760196000.5, "1"]},
            ])))
            .expect(1)
            .mount(&server)
            .await;

        let client = ServiceStatusClient::with_clients(
            gcp_metadata::Client::with_base_url(&server.uri()),
            &format!("{}/query", server.uri()),
        );
        let status = client.status().await.unwrap();

        assert_eq!(find(&status, "tap-ingester").state, ServiceState::Up);
        let appview = find(&status, "observing-appview");
        assert_eq!(appview.instances, Some(2));
        assert_eq!(appview.active_instances, Some(0));
        assert_eq!(find(&status, "observing-db").state, ServiceState::Up);

        // A second read within the TTL is served from the cache; the
        // `expect(1)`s above fail the test if it calls out again.
        assert_eq!(client.status().await.unwrap(), status);
    }

    #[tokio::test]
    async fn monitoring_error_is_returned() {
        let server = MockServer::start().await;
        Mock::given(path(TOKEN_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "test-token",
            })))
            .mount(&server)
            .await;
        Mock::given(path("/query"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let client = ServiceStatusClient::with_clients(
            gcp_metadata::Client::with_base_url(&server.uri()),
            &format!("{}/query", server.uri()),
        );
        assert!(client.status().await.is_err());
    }

    #[test]
    fn parses_prometheus_samples() {
        let body = r#"{"status":"success","data":{"resultType":"vector","result":[
            {"metric":{"service_name":"tap-ingester","state":"active"},"value":[1760196000.5,"1"]}
        ]}}"#;
        let response: QueryResponse = serde_json::from_str(body).unwrap();

        let sample = &response.data.result[0];
        assert_eq!(sample.metric["service_name"], "tap-ingester");
        assert_eq!(sample.count(), 1);
    }
}
