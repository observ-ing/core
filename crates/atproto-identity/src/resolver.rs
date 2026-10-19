use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use moka::future::Cache;
use reqwest::Client;
use tracing::{debug, error, warn};

use jacquard_common::types::string::Did;

use crate::did::{DidExt, DidMethod};
use crate::types::{
    DidDocument, Profile, ProfileResponse, ProfilesResponse, ResolveHandleResponse, ResolveResult,
};

const DEFAULT_SERVICE_URL: &str = "https://public.api.bsky.app";
const CACHE_TTL_SECS: u64 = 300; // 5 minutes
const BATCH_SIZE: usize = 25;

/// Resolves AT Protocol identities (handles ↔ DIDs) and fetches profiles
pub struct IdentityResolver {
    client: Client,
    service_url: String,
    identity_cache: Cache<String, ResolveResult>,
    profile_cache: Cache<String, Arc<Profile>>,
}

impl IdentityResolver {
    /// Create a new resolver with default settings
    pub fn new() -> Self {
        Self::with_service_url(DEFAULT_SERVICE_URL)
    }

    /// Create a resolver, honoring `HANDLE_RESOLVER_URL` as an override for the
    /// service base used to resolve handles (point this at a local
    /// `@atproto/dev-env` PDS for isolated e2e). Falls back to the public
    /// Bluesky API. did:plc resolution is governed separately by
    /// [`crate::plc_directory_url`].
    pub fn from_env() -> Self {
        match std::env::var("HANDLE_RESOLVER_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            Some(url) => Self::with_service_url(&url),
            None => Self::new(),
        }
    }

    /// Create a new resolver with a custom Bluesky API URL
    pub fn with_service_url(service_url: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        let identity_cache = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(CACHE_TTL_SECS))
            .build();

        let profile_cache = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(CACHE_TTL_SECS))
            .build();

        Self {
            client,
            service_url: service_url.to_string(),
            identity_cache,
            profile_cache,
        }
    }

    /// Resolve a handle to a DID
    pub async fn resolve_handle(&self, handle: &str) -> Option<ResolveResult> {
        // Check cache
        if let Some(cached) = self.identity_cache.get(handle).await {
            return Some(cached);
        }

        let url = format!(
            "{}/xrpc/com.atproto.identity.resolveHandle?handle={}",
            self.service_url, handle
        );

        match self.client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                match response.json::<ResolveHandleResponse>().await {
                    Ok(data) => {
                        let did = match Did::new_owned(&data.did) {
                            Ok(d) => d,
                            Err(e) => {
                                warn!(
                                    handle,
                                    raw_did = %data.did,
                                    error = %e,
                                    "resolveHandle returned a DID that failed validation",
                                );
                                return None;
                            }
                        };

                        let pds_endpoint = self.get_pds_endpoint(&did).await;
                        let result = ResolveResult {
                            did: did.clone(),
                            handle: Some(handle.to_string()),
                            pds_endpoint,
                        };

                        // Cache by both handle and DID
                        self.identity_cache
                            .insert(handle.to_string(), result.clone())
                            .await;
                        self.identity_cache
                            .insert(did.as_str().to_string(), result.clone())
                            .await;

                        Some(result)
                    }
                    Err(e) => {
                        error!("Failed to parse resolve handle response: {e}");
                        None
                    }
                }
            }
            Ok(response) => {
                debug!(
                    "Failed to resolve handle {handle}: status {}",
                    response.status()
                );
                None
            }
            Err(e) => {
                error!("Failed to resolve handle {handle}: {e}");
                None
            }
        }
    }

    /// Resolve a DID to its document and extract handle
    pub async fn resolve_did(&self, did: &Did) -> Option<ResolveResult> {
        // Check cache
        if let Some(cached) = self.identity_cache.get(did.as_str()).await {
            return Some(cached);
        }

        let doc = self.get_did_document(did).await?;

        let mut result = ResolveResult {
            did: did.clone(),
            handle: None,
            pds_endpoint: None,
        };

        // Extract handle from alsoKnownAs
        if let Some(ref akas) = doc.also_known_as {
            for aka in akas {
                if let Some(handle) = aka.strip_prefix("at://") {
                    result.handle = Some(handle.to_string());
                    break;
                }
            }
        }

        // Extract PDS endpoint
        if let Some(ref services) = doc.service {
            if let Some(pds) = services.iter().find(|s| s.id == "#atproto_pds") {
                result.pds_endpoint = Some(pds.service_endpoint.clone());
            }
        }

        // Cache
        self.identity_cache
            .insert(did.as_str().to_string(), result.clone())
            .await;
        if let Some(ref handle) = result.handle {
            self.identity_cache
                .insert(handle.clone(), result.clone())
                .await;
        }

        Some(result)
    }

    /// Get the DID document for a DID
    async fn get_did_document(&self, did: &Did) -> Option<DidDocument> {
        fetch_did_document(&self.client, did).await
    }

    /// Get the PDS endpoint for a DID
    pub async fn get_pds_endpoint(&self, did: &Did) -> Option<String> {
        resolve_pds_endpoint(&self.client, did).await
    }

    /// Get a user's profile
    pub async fn get_profile(&self, actor: &str) -> Option<Arc<Profile>> {
        // Check cache
        if let Some(cached) = self.profile_cache.get(actor).await {
            return Some(cached);
        }

        let url = format!(
            "{}/xrpc/app.bsky.actor.getProfile?actor={}",
            self.service_url, actor
        );

        match self.client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                match response.json::<ProfileResponse>().await {
                    Ok(data) => {
                        let did = data.did.clone();
                        let handle = data.handle.clone();
                        let profile = Arc::new(Profile::from(data));

                        // Cache by both DID and handle
                        self.profile_cache.insert(did, profile.clone()).await;
                        self.profile_cache.insert(handle, profile.clone()).await;

                        Some(profile)
                    }
                    Err(e) => {
                        error!("Failed to parse profile response: {e}");
                        None
                    }
                }
            }
            _ => None,
        }
    }

    /// Batch resolve multiple DIDs/handles to profiles
    pub async fn get_profiles(&self, actors: &[String]) -> HashMap<String, Arc<Profile>> {
        let mut results = HashMap::new();
        let mut to_fetch = Vec::new();
        let mut seen = HashSet::new();

        // Check cache first. Callers pass one actor per row, so a page usually
        // repeats actors; dedupe so each is looked up (and fetched) once.
        for actor in actors {
            if !seen.insert(actor.as_str()) {
                continue;
            }
            if let Some(cached) = self.profile_cache.get(actor).await {
                results.insert(actor.clone(), cached);
            } else {
                to_fetch.push(actor.as_str());
            }
        }

        // Fetch uncached profiles, all batches in parallel
        let batches = futures::future::join_all(
            to_fetch
                .chunks(BATCH_SIZE)
                .map(|batch| self.fetch_profiles_batch(batch)),
        )
        .await;
        for profile in batches.into_iter().flatten() {
            results.insert(profile.did.clone(), profile.clone());
            results.insert(profile.handle.clone(), profile);
        }

        results
    }

    /// Fetch one `getProfiles` batch, caching each profile by DID and handle.
    async fn fetch_profiles_batch(&self, batch: &[&str]) -> Vec<Arc<Profile>> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/xrpc/app.bsky.actor.getProfiles",
            self.service_url
        ))
        .unwrap();
        {
            let mut params = url.query_pairs_mut();
            for actor in batch {
                params.append_pair("actors", actor);
            }
        }

        let data = match self.client.get(url).send().await {
            Ok(response) if response.status().is_success() => {
                match response.json::<ProfilesResponse>().await {
                    Ok(data) => data,
                    Err(_) => return Vec::new(),
                }
            }
            _ => {
                error!("Failed to fetch batch of profiles");
                return Vec::new();
            }
        };

        let mut profiles = Vec::with_capacity(data.profiles.len());
        for p in data.profiles {
            let did = p.did.clone();
            let handle = p.handle.clone();
            let profile = Arc::new(Profile::from(p));

            self.profile_cache.insert(did, profile.clone()).await;
            self.profile_cache.insert(handle, profile.clone()).await;
            profiles.push(profile);
        }
        profiles
    }
}

impl Default for IdentityResolver {
    fn default() -> Self {
        Self::new()
    }
}

/// Fetch and deserialize a DID document. `did:plc` is resolved via
/// plc.directory; `did:web` via the host's `/.well-known/did.json`.
async fn fetch_did_document(client: &Client, did: &Did) -> Option<DidDocument> {
    let url = match did.method() {
        Some(DidMethod::Plc(_)) => format!("{}/{}", crate::plc_directory_url(), did.as_str()),
        Some(DidMethod::Web(host)) => {
            let domain = host.replace("%3A", ":");
            format!("https://{domain}/.well-known/did.json")
        }
        None => {
            warn!(did = %did, "unsupported DID method; cannot resolve document");
            return None;
        }
    };

    match client.get(&url).send().await {
        Ok(response) if response.status().is_success() => response.json::<DidDocument>().await.ok(),
        _ => None,
    }
}

/// Resolve a DID to its `#atproto_pds` service endpoint, if the DID document
/// declares one.
///
/// A standalone counterpart to [`IdentityResolver::get_pds_endpoint`] that takes
/// a borrowed [`Client`] instead of an `IdentityResolver`, so callers that only
/// need PDS resolution (e.g. blob/record fetching) can reuse this logic without
/// constructing the handle/profile caches.
pub async fn resolve_pds_endpoint(client: &Client, did: &Did) -> Option<String> {
    let doc = fetch_did_document(client, did).await?;
    doc.service?
        .iter()
        .find(|s| s.id == "#atproto_pds")
        .map(|s| s.service_endpoint.clone())
}
