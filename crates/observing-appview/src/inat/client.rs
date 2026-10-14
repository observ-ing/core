//! The iNaturalist API calls observ.ing makes, over the v2 API.
//!
//! Every call takes the user's API token (the JWT from
//! `inaturalist_oauth::api_token`) and goes through one process-wide rate
//! limiter, because all of observ.ing's users share one iNaturalist
//! application and so one request budget.

use std::fmt;
use std::time::Duration;

use inaturalist::v2::apis::configuration::{ApiKey, Configuration};
use inaturalist::v2::apis::{self, users_api};
use tokio::sync::Mutex;
use tokio::time::Instant;

/// Identifies observ.ing to iNaturalist, as their API terms ask.
const USER_AGENT: &str = "observ.ing cross-post (+https://observ.ing)";

/// Why a call to iNaturalist failed.
#[derive(Debug, Clone, PartialEq)]
pub struct InatError {
    pub message: String,
}

impl InatError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
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
                InatError::new(format!("iNaturalist returned {}: {body}", response.status))
            }
            other => InatError::new(format!("iNaturalist request failed: {other}")),
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
            .ok_or_else(|| InatError::new("iNaturalist returned no account for the token"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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

    #[tokio::test]
    async fn me_returns_the_accounts_id_and_login() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/users/me"))
            .and(header("Authorization", "jwt"))
            .and(header("User-Agent", USER_AGENT))
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

    #[tokio::test]
    async fn me_fails_without_an_account() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/users/me"))
            .respond_with(results(json!([])))
            .mount(&server)
            .await;

        let error = client(&server).me("jwt").await.unwrap_err();

        assert!(error.message.contains("no account"), "{error}");
    }

    #[tokio::test]
    async fn a_rejection_reports_the_status_and_inaturalists_explanation() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/users/me"))
            .respond_with(
                ResponseTemplate::new(401).set_body_json(json!({ "error": "Unauthorized token" })),
            )
            .mount(&server)
            .await;

        let error = client(&server).me("jwt").await.unwrap_err();

        assert!(error.message.contains("401"), "{error}");
        assert!(error.message.contains("Unauthorized token"), "{error}");
    }

    #[tokio::test]
    async fn gives_up_on_a_response_that_never_comes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/users/me"))
            .respond_with(
                results(json!([{ "id": 7, "login": "kueda" }])).set_delay(Duration::from_secs(3)),
            )
            .mount(&server)
            .await;
        let client = InatClient::new(server.uri(), Duration::ZERO, Duration::from_millis(100));

        let started = std::time::Instant::now();
        let result = client.me("jwt").await;

        assert!(
            started.elapsed() < Duration::from_secs(2),
            "waited for the response"
        );
        assert!(result.is_err());
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
