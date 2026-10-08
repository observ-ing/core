//! The iNaturalist API calls cross-posting makes, over the v2 API.
//!
//! Every call takes the user's API token (the JWT from
//! `inaturalist_oauth::api_token`) and goes through one process-wide rate
//! limiter, because all of observ.ing's users share one iNaturalist
//! application and so one request budget.

use std::fmt;
use std::time::Duration;

use inaturalist::v2::apis::configuration::{ApiKey, Configuration};
use inaturalist::v2::apis::{self, observation_photos_api, observations_api, taxa_api, users_api};
use inaturalist::v2::models::{ObservationsCreate, ObservationsCreateObservation};
use inaturalist::Upload;
use tokio::sync::Mutex;
use tokio::time::Instant;
use uuid::Uuid;

use super::payload::exact_taxon_match;

/// Identifies observ.ing to iNaturalist, as their API terms ask.
const USER_AGENT: &str = "observ.ing cross-post (+https://observ.ing)";

/// Why a cross-post step failed.
#[derive(Debug, Clone, PartialEq)]
pub struct InatError {
    /// Shown to the owner of a failed cross-post as its `last_error`, so it
    /// must not carry internal detail. Log that where the error is made.
    pub message: String,
    /// Whether trying again could not help, e.g. iNaturalist rejected the
    /// observation. A permanent failure is reported straight away instead of
    /// being retried.
    pub permanent: bool,
}

impl InatError {
    /// A failure worth retrying.
    pub fn transient(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            permanent: false,
        }
    }

    /// A failure that retrying won't fix.
    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            permanent: true,
        }
    }
}

impl fmt::Display for InatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for InatError {}

impl<T: fmt::Debug> From<apis::Error<T>> for InatError {
    /// Keeps the response body, which is where iNaturalist explains a failure.
    fn from(error: apis::Error<T>) -> Self {
        match error {
            apis::Error::ResponseError(response) => {
                let body: String = response.content.chars().take(500).collect();
                let message = format!("iNaturalist returned {}: {body}", response.status);
                // A 4xx is iNaturalist rejecting the request, which a retry
                // would only repeat, unless it is asking us to wait.
                let rejected = response.status.is_client_error()
                    && response.status != reqwest::StatusCode::REQUEST_TIMEOUT
                    && response.status != reqwest::StatusCode::TOO_MANY_REQUESTS;
                if rejected {
                    InatError::permanent(message)
                } else {
                    InatError::transient(message)
                }
            }
            other => InatError::transient(format!("iNaturalist request failed: {other}")),
        }
    }
}

/// The iNaturalist account an API token belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct InatUser {
    pub id: i32,
    pub login: String,
}

/// Spaces calls at least `min_interval` apart, in the order they arrive.
struct RateLimiter {
    min_interval: Duration,
    next_call: Mutex<Instant>,
}

impl RateLimiter {
    fn new(min_interval: Duration) -> Self {
        Self {
            min_interval,
            next_call: Mutex::new(Instant::now()),
        }
    }

    /// Wait for this call's turn.
    async fn acquire(&self) {
        // Holding the lock while waiting is what queues callers in order.
        let mut next_call = self.next_call.lock().await;
        tokio::time::sleep_until(*next_call).await;
        *next_call = Instant::now() + self.min_interval;
    }
}

pub struct InatClient {
    api_url: String,
    http: reqwest::Client,
    limiter: RateLimiter,
}

impl InatClient {
    /// `min_interval` is the spacing between calls; iNaturalist asks for at
    /// most 60 requests a minute. `timeout` bounds each request, so one that
    /// iNaturalist never answers can't hold up everything queued behind it.
    pub fn new(api_url: impl Into<String>, min_interval: Duration, timeout: Duration) -> Self {
        Self {
            api_url: api_url.into(),
            http: reqwest::Client::builder()
                .timeout(timeout)
                .build()
                .expect("failed to build the iNaturalist HTTP client"),
            limiter: RateLimiter::new(min_interval),
        }
    }

    fn configuration(&self, jwt: &str) -> Configuration {
        Configuration {
            base_path: self.api_url.clone(),
            user_agent: Some(USER_AGENT.to_string()),
            client: self.http.clone(),
            basic_auth: None,
            oauth_access_token: None,
            bearer_access_token: None,
            // iNaturalist takes the bare token, with no "Bearer" prefix.
            api_key: Some(ApiKey {
                prefix: None,
                key: jwt.to_string(),
            }),
        }
    }

    pub async fn me(&self, jwt: &str) -> Result<InatUser, InatError> {
        self.limiter.acquire().await;
        let response = users_api::users_me_get(
            &self.configuration(jwt),
            users_api::UsersMeGetParams {
                fields: Some("id,login".to_string()),
            },
        )
        .await?;
        response
            .results
            .into_iter()
            .next()
            .and_then(|user| {
                Some(InatUser {
                    id: user.id,
                    login: user.login?,
                })
            })
            .ok_or_else(|| InatError::transient("iNaturalist returned no account for the token"))
    }

    /// The ID of the iNaturalist taxon named exactly `name` at `rank`, if
    /// there is exactly one.
    pub async fn find_taxon_id(
        &self,
        jwt: &str,
        name: &str,
        rank: Option<&str>,
    ) -> Result<Option<i32>, InatError> {
        self.limiter.acquire().await;
        let response = taxa_api::taxa_get(
            &self.configuration(jwt),
            taxa_api::TaxaGetParams {
                q: Some(name.to_string()),
                rank: rank.map(|rank| vec![rank.to_lowercase()]),
                fields: Some("id,name,rank".to_string()),
                is_active: None,
                iconic: None,
                taxon_id: None,
                parent_id: None,
                rank_level: None,
                id_above: None,
                id_below: None,
                per_page: None,
                locale: None,
                preferred_place_id: None,
                x_http_method_override: None,
            },
        )
        .await?;
        Ok(exact_taxon_match(&response.results, name, rank))
    }

    /// Create the observation, or update the one with the same UUID. Returns
    /// its numeric ID.
    pub async fn upsert_observation(
        &self,
        jwt: &str,
        observation: ObservationsCreateObservation,
    ) -> Result<i32, InatError> {
        self.limiter.acquire().await;
        let response = observations_api::observations_post(
            &self.configuration(jwt),
            observations_api::ObservationsPostParams {
                observations_create: Some(ObservationsCreate {
                    // v2 returns only the UUID unless asked for more.
                    fields: Some(Some(serde_json::json!({ "id": true }))),
                    observation: Some(Box::new(observation)),
                }),
            },
        )
        .await?;
        response
            .results
            .first()
            .and_then(|observation| observation.id.flatten())
            .ok_or_else(|| InatError::transient("iNaturalist returned no id for the observation"))
    }

    /// Attach a photo to an observation, or replace the one with the same UUID.
    pub async fn attach_photo(
        &self,
        jwt: &str,
        observation_uuid: Uuid,
        photo_uuid: Uuid,
        position: i32,
        photo: Upload,
    ) -> Result<(), InatError> {
        self.limiter.acquire().await;
        observation_photos_api::observation_photos_post(
            &self.configuration(jwt),
            observation_photos_api::ObservationPhotosPostParams {
                observation_photo_left_square_bracket_observation_id_right_square_bracket:
                    observation_uuid.to_string(),
                file: photo,
                // The response model requires the photo's id, so ask for it.
                fields: Some("id,uuid".to_string()),
                observation_photo_left_square_bracket_uuid_right_square_bracket: Some(
                    photo_uuid.to_string(),
                ),
                observation_photo_left_square_bracket_position_right_square_bracket: Some(position),
            },
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const OBSERVATION_UUID: &str = "0a1b2c3d-0000-4000-8000-000000000001";
    const PHOTO_UUID: &str = "0a1b2c3d-0000-4000-8000-000000000002";

    fn client(server: &MockServer) -> InatClient {
        InatClient::new(server.uri(), Duration::ZERO, Duration::from_secs(5))
    }

    fn results(results: Value) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({
            "total_results": 1,
            "page": 1,
            "per_page": 1,
            "results": results,
        }))
    }

    fn observation() -> ObservationsCreateObservation {
        ObservationsCreateObservation {
            uuid: Some(OBSERVATION_UUID.parse().unwrap()),
            taxon_id: Some(48484),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn upsert_observation_asks_for_and_returns_the_id() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/observations"))
            .and(header("Authorization", "jwt"))
            .and(header("User-Agent", USER_AGENT))
            .respond_with(results(json!([{ "uuid": OBSERVATION_UUID, "id": 123 }])))
            .mount(&server)
            .await;

        let id = client(&server)
            .upsert_observation("jwt", observation())
            .await
            .unwrap();

        assert_eq!(id, 123);
        let requests = server.received_requests().await.unwrap();
        let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert_eq!(
            body,
            json!({
                "fields": { "id": true },
                "observation": { "uuid": OBSERVATION_UUID, "taxon_id": 48484 },
            })
        );
    }

    #[tokio::test]
    async fn upsert_observation_fails_without_an_id_to_link_to() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/observations"))
            .respond_with(results(json!([{ "uuid": OBSERVATION_UUID }])))
            .mount(&server)
            .await;

        let error = client(&server)
            .upsert_observation("jwt", observation())
            .await
            .unwrap_err();

        assert!(error.message.contains("no id"), "{error}");
    }

    #[tokio::test]
    async fn a_rejection_reports_the_status_and_inaturalists_explanation() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/observations"))
            .respond_with(
                ResponseTemplate::new(422)
                    .set_body_json(json!({ "errors": ["Observed on can't be in the future"] })),
            )
            .mount(&server)
            .await;

        let error = client(&server)
            .upsert_observation("jwt", observation())
            .await
            .unwrap_err();

        assert!(error.message.contains("422"), "{error}");
        assert!(error.message.contains("can't be in the future"), "{error}");
    }

    async fn error_for_status(status: u16) -> InatError {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/observations"))
            .respond_with(ResponseTemplate::new(status).set_body_json(json!({ "error": "no" })))
            .mount(&server)
            .await;
        client(&server)
            .upsert_observation("jwt", observation())
            .await
            .unwrap_err()
    }

    #[tokio::test]
    async fn a_rejection_is_permanent() {
        // Retrying can't make iNaturalist accept the same observation.
        assert!(error_for_status(422).await.permanent);
        assert!(error_for_status(401).await.permanent);
    }

    #[tokio::test]
    async fn server_trouble_and_rate_limiting_are_worth_retrying() {
        assert!(!error_for_status(500).await.permanent);
        assert!(!error_for_status(503).await.permanent);
        assert!(!error_for_status(429).await.permanent);
        assert!(!error_for_status(408).await.permanent);
    }

    #[tokio::test]
    async fn gives_up_on_a_response_that_never_comes() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/observations"))
            .respond_with(
                results(json!([{ "uuid": OBSERVATION_UUID, "id": 123 }]))
                    .set_delay(Duration::from_secs(3)),
            )
            .mount(&server)
            .await;
        let client = InatClient::new(server.uri(), Duration::ZERO, Duration::from_millis(100));

        let started = std::time::Instant::now();
        let error = client
            .upsert_observation("jwt", observation())
            .await
            .unwrap_err();

        assert!(
            started.elapsed() < Duration::from_secs(2),
            "waited for the response"
        );
        assert!(!error.permanent);
    }

    #[tokio::test]
    async fn attach_photo_uploads_the_bytes_under_both_uuids() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/observation_photos"))
            .and(header("Authorization", "jwt"))
            .respond_with(results(json!([{ "id": 456, "uuid": PHOTO_UUID }])))
            .mount(&server)
            .await;

        client(&server)
            .attach_photo(
                "jwt",
                OBSERVATION_UUID.parse().unwrap(),
                PHOTO_UUID.parse().unwrap(),
                2,
                Upload {
                    file_name: "bafkrei1.jpg".into(),
                    content_type: Some("image/jpeg".into()),
                    data: b"photo bytes".to_vec(),
                },
            )
            .await
            .unwrap();

        let requests = server.received_requests().await.unwrap();
        let body = String::from_utf8_lossy(&requests[0].body);
        for expected in [
            format!("name=\"observation_photo[observation_id]\"\r\n\r\n{OBSERVATION_UUID}"),
            format!("name=\"observation_photo[uuid]\"\r\n\r\n{PHOTO_UUID}"),
            "name=\"observation_photo[position]\"\r\n\r\n2".to_string(),
            "name=\"fields\"\r\n\r\nid,uuid".to_string(),
            "name=\"file\"; filename=\"bafkrei1.jpg\"".to_string(),
            "Content-Type: image/jpeg".to_string(),
            "photo bytes".to_string(),
        ] {
            assert!(body.contains(&expected), "missing {expected:?} in {body}");
        }
    }

    #[tokio::test]
    async fn find_taxon_id_searches_by_name_and_rank_and_wants_an_exact_match() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/taxa"))
            .and(query_param("q", "Harmonia axyridis"))
            .and(query_param("rank", "species"))
            .and(query_param("fields", "id,name,rank"))
            .respond_with(results(json!([
                { "id": 1, "name": "Harmonia axyridis succinea", "rank": "variety" },
                { "id": 48484, "name": "Harmonia axyridis", "rank": "species" },
            ])))
            .mount(&server)
            .await;
        let client = client(&server);

        assert_eq!(
            client
                .find_taxon_id("jwt", "Harmonia axyridis", Some("Species"))
                .await
                .unwrap(),
            Some(48484)
        );
    }

    #[tokio::test]
    async fn find_taxon_id_finds_nothing_among_near_misses() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/taxa"))
            .respond_with(results(json!([
                { "id": 1, "name": "Harmonia axyridis succinea", "rank": "variety" },
            ])))
            .mount(&server)
            .await;

        assert_eq!(
            client(&server)
                .find_taxon_id("jwt", "Harmonia axyridis", None)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn me_returns_the_accounts_id_and_login() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/users/me"))
            .and(header("Authorization", "jwt"))
            .and(query_param("fields", "id,login"))
            .respond_with(results(json!([{ "id": 7, "login": "kueda" }])))
            .mount(&server)
            .await;

        assert_eq!(
            client(&server).me("jwt").await.unwrap(),
            InatUser {
                id: 7,
                login: "kueda".into()
            }
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_rate_limiter_spaces_calls_out() {
        let limiter = RateLimiter::new(Duration::from_secs(1));
        let start = Instant::now();

        limiter.acquire().await;
        assert_eq!(start.elapsed(), Duration::ZERO);
        limiter.acquire().await;
        assert_eq!(start.elapsed(), Duration::from_secs(1));
        limiter.acquire().await;
        assert_eq!(start.elapsed(), Duration::from_secs(2));
    }

    #[tokio::test(start_paused = true)]
    async fn the_rate_limiter_does_not_bank_idle_time() {
        let limiter = RateLimiter::new(Duration::from_secs(1));
        limiter.acquire().await;
        tokio::time::sleep(Duration::from_secs(10)).await;
        let start = Instant::now();

        limiter.acquire().await;
        assert_eq!(start.elapsed(), Duration::ZERO);
        limiter.acquire().await;
        assert_eq!(start.elapsed(), Duration::from_secs(1));
    }
}
