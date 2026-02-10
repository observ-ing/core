use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use moka::future::Cache;
use reqwest::Client;
use tracing::{debug, error};

use crate::types::{
    DidDocument, FollowsResponse, Profile, ProfileResponse, ProfilesResponse,
    ResolveHandleResponse, ResolveResult,
};

const DEFAULT_SERVICE_URL: &str = "https://public.api.bsky.app";
const CACHE_TTL_SECS: u64 = 300; // 5 minutes
const FOLLOWS_CACHE_TTL_SECS: u64 = 60; // 1 minute
const BATCH_SIZE: usize = 25;

/// Resolves AT Protocol identities (handles ↔ DIDs) and fetches profiles
pub struct IdentityResolver {
    client: Client,
    service_url: String,
    identity_cache: Cache<String, ResolveResult>,
    profile_cache: Cache<String, Arc<Profile>>,
    follows_cache: Cache<String, Arc<Vec<String>>>,
}

impl IdentityResolver {
    /// Create a new resolver with default settings
    pub fn new() -> Self {
        Self::with_service_url(DEFAULT_SERVICE_URL)
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

        let follows_cache = Cache::builder()
            .max_capacity(1_000)
            .time_to_live(Duration::from_secs(FOLLOWS_CACHE_TTL_SECS))
            .build();

        Self {
            client,
            service_url: service_url.to_string(),
            identity_cache,
            profile_cache,
            follows_cache,
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
                        let mut result = ResolveResult {
                            did: data.did.clone(),
                            handle: Some(handle.to_string()),
                            pds_endpoint: None,
                        };

                        // Get PDS endpoint
                        if let Some(endpoint) = self.get_pds_endpoint(&data.did).await {
                            result.pds_endpoint = Some(endpoint);
                        }

                        // Cache by both handle and DID
                        self.identity_cache
                            .insert(handle.to_string(), result.clone())
                            .await;
                        self.identity_cache.insert(data.did, result.clone()).await;

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
    pub async fn resolve_did(&self, did: &str) -> Option<ResolveResult> {
        // Check cache
        if let Some(cached) = self.identity_cache.get(did).await {
            return Some(cached);
        }

        let doc = self.get_did_document(did).await?;

        let mut result = ResolveResult {
            did: did.to_string(),
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
            .insert(did.to_string(), result.clone())
            .await;
        if let Some(ref handle) = result.handle {
            self.identity_cache
                .insert(handle.clone(), result.clone())
                .await;
        }

        Some(result)
    }

    /// Get the DID document for a DID
    async fn get_did_document(&self, did: &str) -> Option<DidDocument> {
        let url = if did.starts_with("did:plc:") {
            format!("https://plc.directory/{did}")
        } else if did.starts_with("did:web:") {
            let domain = did.strip_prefix("did:web:").unwrap().replace("%3A", ":");
            format!("https://{domain}/.well-known/did.json")
        } else {
            return None;
        };

        match self.client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                response.json::<DidDocument>().await.ok()
            }
            _ => None,
        }
    }

    /// Get the PDS endpoint for a DID
    pub async fn get_pds_endpoint(&self, did: &str) -> Option<String> {
        let doc = self.get_did_document(did).await?;
        doc.service?
            .iter()
            .find(|s| s.id == "#atproto_pds")
            .map(|s| s.service_endpoint.clone())
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
                        let profile = Arc::new(Profile {
                            did: data.did.clone(),
                            handle: data.handle.clone(),
                            display_name: data.display_name,
                            description: data.description,
                            avatar: data.avatar,
                            banner: data.banner,
                            followers_count: data.followers_count,
                            follows_count: data.follows_count,
                            posts_count: data.posts_count,
                        });

                        // Cache by both DID and handle
                        self.profile_cache.insert(data.did, profile.clone()).await;
                        self.profile_cache
                            .insert(data.handle, profile.clone())
                            .await;

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

        // Check cache first
        for actor in actors {
            if let Some(cached) = self.profile_cache.get(actor).await {
                results.insert(actor.clone(), cached);
            } else {
                to_fetch.push(actor.clone());
            }
        }

        // Fetch uncached profiles in batches
        for batch in to_fetch.chunks(BATCH_SIZE) {
            let actors_param = batch
                .iter()
                .map(|a| format!("actors={a}"))
                .collect::<Vec<_>>()
                .join("&");
            let url = format!(
                "{}/xrpc/app.bsky.actor.getProfiles?{actors_param}",
                self.service_url
            );

            match self.client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(data) = response.json::<ProfilesResponse>().await {
                        for p in data.profiles {
                            let profile = Arc::new(Profile {
                                did: p.did.clone(),
                                handle: p.handle.clone(),
                                display_name: p.display_name,
                                description: p.description,
                                avatar: p.avatar,
                                banner: p.banner,
                                followers_count: p.followers_count,
                                follows_count: p.follows_count,
                                posts_count: p.posts_count,
                            });

                            results.insert(p.did.clone(), profile.clone());
                            results.insert(p.handle.clone(), profile.clone());

                            self.profile_cache.insert(p.did, profile.clone()).await;
                            self.profile_cache.insert(p.handle, profile).await;
                        }
                    }
                }
                _ => {
                    error!("Failed to fetch batch of profiles");
                }
            }
        }

        results
    }

    /// Get a user's follows (DIDs they follow), paginating up to 1000
    pub async fn get_follows(&self, actor: &str) -> Vec<String> {
        // Check cache
        if let Some(cached) = self.follows_cache.get(actor).await {
            return cached.as_ref().clone();
        }

        let mut follows = Vec::new();
        let mut cursor: Option<String> = None;

        loop {
            let mut url = format!(
                "{}/xrpc/app.bsky.graph.getFollows?actor={actor}&limit=100",
                self.service_url
            );
            if let Some(ref c) = cursor {
                url.push_str(&format!("&cursor={c}"));
            }

            match self.client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    match response.json::<FollowsResponse>().await {
                        Ok(data) => {
                            follows.extend(data.follows.into_iter().map(|f| f.did));
                            cursor = data.cursor;
                            if cursor.is_none() || follows.len() >= 1000 {
                                break;
                            }
                        }
                        Err(e) => {
                            error!("Failed to parse follows response: {e}");
                            break;
                        }
                    }
                }
                _ => break,
            }
        }

        // Cache
        let follows_arc = Arc::new(follows.clone());
        self.follows_cache
            .insert(actor.to_string(), follows_arc)
            .await;

        follows
    }
}

impl Default for IdentityResolver {
    fn default() -> Self {
        Self::new()
    }
}
