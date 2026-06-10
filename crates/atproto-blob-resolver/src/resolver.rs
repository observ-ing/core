//! DID resolution and blob fetching from AT Protocol PDS servers

use crate::error::{BlobResolverError, Result};
use at_uri_parser::AtUri;
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

    /// Create a resolver using a caller-provided HTTP client — e.g. one
    /// configured with a request timeout. [`BlobResolver::new`] uses a default
    /// client with no timeout.
    pub fn with_client(client: Client) -> Self {
        Self { client }
    }

    /// Resolve a DID to its PDS URL.
    ///
    /// `did:plc` resolution (plc.directory lookup + `#atproto_pds` extraction) is
    /// delegated to [`atproto_identity::resolve_pds_endpoint`] — the same
    /// implementation `IdentityResolver` uses — so the logic lives in one place.
    /// `did:web` keeps the host-derived shortcut below.
    pub async fn resolve_pds_url(&self, did: &Did) -> Result<String> {
        match did.method() {
            DidMethod::Plc(_) => atproto_identity::resolve_pds_endpoint(&self.client, did)
                .await
                .ok_or_else(|| {
                    BlobResolverError::DidResolution(format!(
                        "could not resolve PDS endpoint for {}",
                        did.as_str()
                    ))
                }),
            DidMethod::Web(host) => self.resolve_web_did(did, host),
        }
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

    /// Fetch a record from a PDS via `com.atproto.repo.getRecord`, returning
    /// the record's `value` (the lexicon record body).
    ///
    /// `getRecord` wraps the record as `{ uri, cid, value }`; this returns the
    /// unwrapped `value`. Use [`BlobResolver::resolve_pds_url`] to obtain
    /// `pds_url` from a DID first.
    pub async fn fetch_record(
        &self,
        pds_url: &str,
        did: &str,
        collection: &str,
        rkey: &str,
    ) -> Result<serde_json::Value> {
        let url = format!(
            "{}/xrpc/com.atproto.repo.getRecord?repo={}&collection={}&rkey={}",
            pds_url.trim_end_matches('/'),
            urlencoding::encode(did),
            urlencoding::encode(collection),
            urlencoding::encode(rkey),
        );

        debug!(url = %url, "Fetching record from PDS");

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            warn!(status = %response.status(), url = %url, "Failed to fetch record");
            return Err(BlobResolverError::RecordFetch(format!(
                "PDS returned status {}",
                response.status()
            )));
        }

        let body: serde_json::Value = response.json().await?;
        body.get("value").cloned().ok_or_else(|| {
            BlobResolverError::RecordFetch("getRecord response missing `value` field".to_string())
        })
    }

    /// Fetch a record straight from its `at://…` URI: parse the URI, resolve
    /// the author's PDS, and [`fetch_record`](Self::fetch_record) the
    /// referenced record's `value`.
    ///
    /// Consolidates the parse-URI → resolve-DID → `getRecord` dance that every
    /// caller (the ingester's media resolver, backfill jobs) would otherwise
    /// repeat. URI/DID parse failures surface as
    /// [`BlobResolverError::RecordFetch`] / [`BlobResolverError::DidResolution`].
    pub async fn fetch_record_by_aturi(&self, at_uri: &str) -> Result<serde_json::Value> {
        let parsed = AtUri::parse(at_uri).ok_or_else(|| {
            BlobResolverError::RecordFetch(format!("unparseable AT-URI: {at_uri}"))
        })?;
        let did = Did::parse(&parsed.did).map_err(|e| {
            BlobResolverError::DidResolution(format!("unparseable DID in {at_uri}: {e}"))
        })?;
        let pds_url = self.resolve_pds_url(&did).await?;
        self.fetch_record(&pds_url, &parsed.did, &parsed.collection, &parsed.rkey)
            .await
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
