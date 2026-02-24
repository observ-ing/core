use std::time::Duration;

use moka::future::Cache;
use tokio::sync::Semaphore;
use tracing::{debug, warn};

use crate::continents::country_to_continent;
use crate::error::NominatimError;
use crate::types::{GeocodedLocation, NominatimResponse};

const DEFAULT_BASE_URL: &str = "https://nominatim.openstreetmap.org";
const DEFAULT_USER_AGENT: &str = "nominatim-client-rs/0.1";
const CACHE_TTL_SECS: u64 = 86400; // 24 hours

/// Nominatim reverse geocoding client with rate limiting and caching
pub struct NominatimClient {
    client: reqwest::Client,
    base_url: String,
    cache: Cache<String, GeocodedLocation>,
    /// Semaphore to enforce 1 request/second rate limit
    rate_limiter: Semaphore,
}

impl NominatimClient {
    /// Create a new client with default settings
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    /// Create a new client with a custom Nominatim URL
    pub fn with_base_url(base_url: &str) -> Self {
        Self::with_base_url_and_user_agent(base_url, DEFAULT_USER_AGENT)
    }

    /// Create a new client with a custom Nominatim URL and user agent
    pub fn with_base_url_and_user_agent(base_url: &str, user_agent: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(user_agent)
            .build()
            .expect("Failed to create HTTP client");

        let cache = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(CACHE_TTL_SECS))
            .build();

        Self {
            client,
            base_url: base_url.to_string(),
            cache,
            rate_limiter: Semaphore::new(1),
        }
    }

    /// Reverse geocode coordinates to location fields
    pub async fn reverse_geocode(
        &self,
        latitude: f64,
        longitude: f64,
    ) -> crate::Result<GeocodedLocation> {
        if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
            return Err(NominatimError::InvalidCoordinates(latitude, longitude));
        }

        // Round to 6 decimal places for cache key (~0.1m precision)
        let cache_key = format!("{:.6},{:.6}", latitude, longitude);

        // Check cache
        if let Some(cached) = self.cache.get(&cache_key).await {
            return Ok(cached);
        }

        // Rate limit: acquire permit, then wait 1 second after the request
        let _permit = self.rate_limiter.acquire().await.unwrap();

        let url = format!(
            "{}/reverse?lat={}&lon={}&format=json&addressdetails=1&zoom=18",
            self.base_url, latitude, longitude
        );

        let response = self
            .client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(NominatimError::Http)?;

        if !response.status().is_success() {
            return Err(NominatimError::ApiError(format!(
                "Nominatim returned status {}",
                response.status()
            )));
        }

        let data: NominatimResponse = response.json().await.map_err(NominatimError::Http)?;

        if let Some(ref err) = data.error {
            warn!(lat = latitude, lon = longitude, error = %err, "Nominatim returned error");
            let result = GeocodedLocation::default();
            self.cache.insert(cache_key, result.clone()).await;
            // Delay to respect rate limit
            tokio::time::sleep(Duration::from_millis(1100)).await;
            return Ok(result);
        }

        let result = parse_nominatim_response(&data);

        debug!(
            lat = latitude,
            lon = longitude,
            country = result.country.as_deref().unwrap_or("unknown"),
            "Geocoded coordinates"
        );

        self.cache.insert(cache_key, result.clone()).await;

        // Delay to respect rate limit (1 req/sec)
        tokio::time::sleep(Duration::from_millis(1100)).await;

        Ok(result)
    }
}

impl Default for NominatimClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse Nominatim response into location fields
fn parse_nominatim_response(data: &NominatimResponse) -> GeocodedLocation {
    let addr = &data.address;
    let mut result = GeocodedLocation::default();

    // Country and country code
    result.country.clone_from(&addr.country);
    if let Some(ref cc) = addr.country_code {
        let cc_upper = cc.to_uppercase();
        // Derive continent from country code
        result.continent = country_to_continent(&cc_upper).map(|s| s.to_string());
        result.country_code = Some(cc_upper);
    }

    // State/province
    result.state_province = addr.state.clone();

    // County
    result.county = addr.county.clone();

    // Municipality - try city, then town, then village, then municipality
    result.municipality = addr
        .city
        .as_ref()
        .or(addr.town.as_ref())
        .or(addr.village.as_ref())
        .or(addr.municipality.as_ref())
        .cloned();

    // Locality - build from available detail
    let locality_parts: Vec<&str> = [&addr.suburb, &addr.neighbourhood, &addr.road]
        .into_iter()
        .filter_map(|opt| opt.as_deref())
        .collect();
    if !locality_parts.is_empty() {
        result.locality = Some(locality_parts.join(", "));
    }

    // Water body
    result.water_body = addr
        .water
        .as_ref()
        .or(addr.bay.as_ref())
        .or(addr.sea.as_ref())
        .or(addr.ocean.as_ref())
        .or(addr.lake.as_ref())
        .or(addr.river.as_ref())
        .cloned();

    result
}
