//! DID resolution and blob fetching from AT Protocol PDS servers

use crate::error::{BlobResolverError, Result};
use crate::types::PlcDirectoryResponse;
use atproto_identity::{Did, DidMethod};
use reqwest::Client;
use tracing::{debug, warn};

/// Resolves AT Protocol DIDs to PDS endpoints and fetches blobs
pub struct BlobResolver {
    client: Client,
}

impl BlobResolver {
    /// Create a new blob resolver
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Resolve a DID to its PDS URL
    pub async fn resolve_pds_url(&self, did: &Did) -> Result<String> {
        match did.method() {
            DidMethod::Plc(_) => self.resolve_plc_did(did).await,
            DidMethod::Web(host) => self.resolve_web_did(did, host),
        }
    }

    /// Resolve a did:plc: DID via plc.directory
    async fn resolve_plc_did(&self, did: &Did) -> Result<String> {
        let url = format!("https://plc.directory/{}", did.as_str());
        debug!(did = %did, url = %url, "Resolving PLC DID");

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(BlobResolverError::DidResolution(format!(
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
                BlobResolverError::DidResolution("No PDS service found in DID document".to_string())
            })?;

        debug!(did = %did, pds_url = %pds_url, "Resolved PDS URL");
        Ok(pds_url)
    }

    /// Resolve a did:web: DID by constructing URL from the host portion.
    /// `host` is the method-specific identifier yielded by `DidMethod::Web`.
    fn resolve_web_did(&self, did: &Did, host: &str) -> Result<String> {
        let domain = host.replace("%3A", ":");
        let url = format!("https://{}", domain);
        debug!(did = %did, url = %url, "Resolved web DID");
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
            return Err(BlobResolverError::DidResolution(format!(
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

impl Default for BlobResolver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn web_did(s: &str) -> Did {
        Did::parse(s).expect("test fixture must parse")
    }

    #[test]
    fn test_resolve_web_did_simple_domain() {
        let resolver = BlobResolver::new();
        let did = web_did("did:web:example.com");
        let DidMethod::Web(host) = did.method() else {
            panic!("expected web method")
        };

        let result = resolver.resolve_web_did(&did, host).unwrap();
        assert_eq!(result, "https://example.com");
    }

    #[test]
    fn test_resolve_web_did_url_encoded_port() {
        let resolver = BlobResolver::new();
        let did = web_did("did:web:example.com%3A8080");
        let DidMethod::Web(host) = did.method() else {
            panic!("expected web method")
        };

        let result = resolver.resolve_web_did(&did, host).unwrap();
        assert_eq!(result, "https://example.com:8080");
    }

    // Unsupported-method coverage now lives at the type boundary: Did::parse
    // refuses anything other than did:plc:/did:web:, so resolve_pds_url cannot
    // be reached with an unsupported method in the first place.
}
