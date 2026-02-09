use serde::{Deserialize, Serialize};
use tracing::error;

/// Client for delegating AT Protocol operations to the TypeScript appview's internal RPC endpoints.
/// This is a transitional approach — in Phase 3, we'll use atrium-oauth directly.
pub struct InternalAgentClient {
    client: reqwest::Client,
    base_url: String,
    secret: Option<String>,
}

#[derive(Serialize)]
struct CreateRecordRequest<'a> {
    did: &'a str,
    collection: &'a str,
    record: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    rkey: Option<&'a str>,
}

#[derive(Serialize)]
struct UploadBlobRequest<'a> {
    did: &'a str,
    data: &'a str, // base64
    #[serde(rename = "mimeType")]
    mime_type: &'a str,
}

#[derive(Debug, Deserialize)]
pub struct RecordResponse {
    pub uri: Option<String>,
    pub cid: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BlobResponse {
    pub blob: Option<serde_json::Value>,
}

impl InternalAgentClient {
    pub fn new(base_url: &str, secret: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            secret,
        }
    }

    fn add_secret(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.secret {
            Some(s) => req.header("X-Internal-Secret", s),
            None => req,
        }
    }

    pub async fn create_record(
        &self,
        did: &str,
        collection: &str,
        record: serde_json::Value,
        rkey: Option<&str>,
    ) -> Result<RecordResponse, String> {
        let body = CreateRecordRequest {
            did,
            collection,
            record,
            rkey,
        };
        let req = self
            .client
            .post(format!("{}/internal/agent/create-record", self.base_url))
            .json(&body);
        let resp = self
            .add_secret(req)
            .send()
            .await
            .map_err(|e| format!("Internal agent request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            error!(%status, %body, "Internal agent create-record failed");
            return Err(format!("Internal agent returned {status}"));
        }
        resp.json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))
    }

    pub async fn upload_blob(
        &self,
        did: &str,
        data_base64: &str,
        mime_type: &str,
    ) -> Result<BlobResponse, String> {
        let body = UploadBlobRequest {
            did,
            data: data_base64,
            mime_type,
        };
        let req = self
            .client
            .post(format!("{}/internal/agent/upload-blob", self.base_url))
            .json(&body);
        let resp = self
            .add_secret(req)
            .send()
            .await
            .map_err(|e| format!("Internal agent request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            error!(%status, %body, "Internal agent upload-blob failed");
            return Err(format!("Internal agent returned {status}"));
        }
        resp.json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))
    }
}
