//! PDS resolution and blob fetching

use crate::error::{MediaProxyError, Result};
use crate::types::PlcDirectoryResponse;
use reqwest::Client;
use tracing::{debug, warn};

/// HTTP client for fetching blobs from PDS servers
pub struct BlobFetcher {
    client: Client,
}

impl BlobFetcher {
    /// Create a new blob fetcher
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Resolve a DID to its PDS URL
    pub async fn resolve_pds_url(&self, did: &str) -> Result<String> {
        // Handle did:plc: DIDs via plc.directory
        if did.starts_with("did:plc:") {
            return self.resolve_plc_did(did).await;
        }

        // Handle did:web: DIDs by constructing URL from domain
        if did.starts_with("did:web:") {
            return self.resolve_web_did(did);
        }

        Err(MediaProxyError::DidResolution(format!(
            "Unsupported DID method: {}",
            did
        )))
    }

    /// Resolve a did:plc: DID via plc.directory
    async fn resolve_plc_did(&self, did: &str) -> Result<String> {
        let url = format!("https://plc.directory/{}", did);
        debug!(did, url = %url, "Resolving PLC DID");

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(MediaProxyError::DidResolution(format!(
                "PLC directory returned status {}",
                response.status()
            )));
        }

        let doc: PlcDirectoryResponse = response.json().await?;

        // Find the #atproto_pds service
        let pds_url = doc
            .service
            .and_then(|services| {
                services
                    .into_iter()
                    .find(|s| s.id == "#atproto_pds")
                    .map(|s| s.service_endpoint)
            })
            .ok_or_else(|| {
                MediaProxyError::DidResolution("No PDS service found in DID document".to_string())
            })?;

        debug!(did, pds_url = %pds_url, "Resolved PDS URL");
        Ok(pds_url)
    }

    /// Resolve a did:web: DID by constructing URL from domain
    fn resolve_web_did(&self, did: &str) -> Result<String> {
        let domain = did
            .strip_prefix("did:web:")
            .ok_or_else(|| MediaProxyError::DidResolution("Invalid did:web format".to_string()))?
            .replace("%3A", ":");

        let url = format!("https://{}", domain);
        debug!(did, url = %url, "Resolved web DID");
        Ok(url)
    }

    /// Fetch a blob from a PDS server
    pub async fn fetch_blob(
        &self,
        pds_url: &str,
        did: &str,
        cid: &str,
    ) -> Result<(Vec<u8>, String)> {
        let url = format!(
            "{}/xrpc/com.atproto.sync.getBlob?did={}&cid={}",
            pds_url,
            urlencoding::encode(did),
            urlencoding::encode(cid)
        );

        debug!(url = %url, "Fetching blob from PDS");

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            warn!(status = %response.status(), url = %url, "Failed to fetch blob");
            return Err(MediaProxyError::DidResolution(format!(
                "PDS returned status {}",
                response.status()
            )));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();

        let data = response.bytes().await?.to_vec();

        debug!(
            size = data.len(),
            content_type = %content_type,
            "Fetched blob from PDS"
        );

        Ok((data, content_type))
    }
}

impl Default for BlobFetcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_web_did() {
        let fetcher = BlobFetcher::new();

        // Simple domain
        let result = fetcher.resolve_web_did("did:web:example.com");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "https://example.com");

        // Domain with port (URL encoded colon)
        let result = fetcher.resolve_web_did("did:web:example.com%3A8080");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "https://example.com:8080");
    }

    #[test]
    fn test_resolve_web_did_invalid() {
        let fetcher = BlobFetcher::new();

        // Invalid prefix
        let result = fetcher.resolve_web_did("did:plc:abc123");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_resolve_pds_url_unsupported_method() {
        let fetcher = BlobFetcher::new();

        let result = fetcher.resolve_pds_url("did:key:abc123").await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unsupported DID method"));
    }
}
