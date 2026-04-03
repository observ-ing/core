use crate::error::{QuickSliceError, Result};
use reqwest::Url;
use serde::de::DeserializeOwned;
use tracing::debug;

/// Raw GraphQL response envelope.
#[derive(serde::Deserialize)]
struct GraphQLResponse<T> {
    data: Option<T>,
    errors: Option<Vec<crate::error::GraphQLError>>,
}

/// Client for querying a QuickSlice GraphQL endpoint.
#[derive(Clone)]
pub struct QuickSliceClient {
    http: reqwest::Client,
    graphql_url: Url,
}

impl QuickSliceClient {
    pub fn new(base_url: &str) -> Self {
        let mut graphql_url: Url = base_url.parse().expect("invalid QuickSlice base URL");
        graphql_url.set_path("/graphql");
        Self {
            http: reqwest::Client::new(),
            graphql_url,
        }
    }

    /// Returns the WebSocket URL for GraphQL subscriptions.
    /// Converts `http://` to `ws://` and `https://` to `wss://`.
    pub fn ws_url(&self) -> String {
        let mut url = self.graphql_url.clone();
        match url.scheme() {
            "http" => url.set_scheme("ws").unwrap(),
            "https" => url.set_scheme("wss").unwrap(),
            _ => {}
        }
        url.to_string()
    }

    /// Execute a GraphQL query and deserialize the `data` field into `T`.
    pub async fn query<T: DeserializeOwned>(
        &self,
        query: &str,
        variables: Option<serde_json::Value>,
    ) -> Result<T> {
        let mut body = serde_json::json!({ "query": query });
        if let Some(vars) = variables {
            body["variables"] = vars;
        }

        debug!(url = %self.graphql_url, "GraphQL query");

        let resp = self
            .http
            .post(self.graphql_url.clone())
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let raw: GraphQLResponse<T> = resp.json().await?;

        if let Some(errors) = raw.errors {
            if !errors.is_empty() {
                return Err(QuickSliceError::GraphQL(errors));
            }
        }

        raw.data
            .ok_or_else(|| QuickSliceError::GraphQL(vec![crate::error::GraphQLError {
                message: "No data in response".to_string(),
                path: None,
            }]))
    }
}
