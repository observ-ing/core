use moka::future::Cache;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::Semaphore;
use tracing::{debug, warn};

const DEFAULT_BASE_URL: &str = "https://nominatim.openstreetmap.org";
const USER_AGENT: &str = "Observ.ing/1.0 (https://github.com/observ-ing/core)";
const CACHE_TTL_SECS: u64 = 86400; // 24 hours

/// Darwin Core location fields populated by geocoding
#[derive(Debug, Clone, Default)]
pub struct GeocodedLocation {
    pub continent: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub state_province: Option<String>,
    pub county: Option<String>,
    pub municipality: Option<String>,
    pub locality: Option<String>,
    pub water_body: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NominatimResponse {
    address: NominatimAddress,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NominatimAddress {
    country: Option<String>,
    country_code: Option<String>,
    state: Option<String>,
    county: Option<String>,
    city: Option<String>,
    town: Option<String>,
    village: Option<String>,
    municipality: Option<String>,
    suburb: Option<String>,
    neighbourhood: Option<String>,
    road: Option<String>,
    water: Option<String>,
    bay: Option<String>,
    sea: Option<String>,
    ocean: Option<String>,
    lake: Option<String>,
    river: Option<String>,
}

/// Reverse geocoding service using Nominatim with rate limiting and caching
pub struct GeocodingService {
    client: reqwest::Client,
    base_url: String,
    cache: Cache<String, GeocodedLocation>,
    /// Semaphore to enforce 1 request/second rate limit
    rate_limiter: Semaphore,
}

impl GeocodingService {
    /// Create a new geocoding service with default settings
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    /// Create a new geocoding service with a custom Nominatim URL
    pub fn with_base_url(base_url: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(USER_AGENT)
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

    /// Reverse geocode coordinates to Darwin Core location fields
    pub async fn reverse_geocode(
        &self,
        latitude: f64,
        longitude: f64,
    ) -> Result<GeocodedLocation, GeocodingError> {
        if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
            return Err(GeocodingError::InvalidCoordinates(latitude, longitude));
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
            .map_err(GeocodingError::Http)?;

        if !response.status().is_success() {
            return Err(GeocodingError::ApiError(format!(
                "Nominatim returned status {}",
                response.status()
            )));
        }

        let data: NominatimResponse = response.json().await.map_err(GeocodingError::Http)?;

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

impl Default for GeocodingService {
    fn default() -> Self {
        Self::new()
    }
}

/// Errors from the geocoding service
#[derive(Debug)]
pub enum GeocodingError {
    InvalidCoordinates(f64, f64),
    Http(reqwest::Error),
    ApiError(String),
}

impl std::fmt::Display for GeocodingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidCoordinates(lat, lng) => {
                write!(f, "Invalid coordinates: {lat}, {lng}")
            }
            Self::Http(e) => write!(f, "HTTP error: {e}"),
            Self::ApiError(msg) => write!(f, "API error: {msg}"),
        }
    }
}

impl std::error::Error for GeocodingError {}

/// Parse Nominatim response into Darwin Core location fields
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
    result.state_province.clone_from(&addr.state);

    // County
    result.county.clone_from(&addr.county);

    // Municipality - try city, then town, then village, then municipality
    result.municipality = addr
        .city
        .clone()
        .or_else(|| addr.town.clone())
        .or_else(|| addr.village.clone())
        .or_else(|| addr.municipality.clone());

    // Locality - build from available detail
    let mut locality_parts = Vec::new();
    if let Some(ref suburb) = addr.suburb {
        locality_parts.push(suburb.as_str());
    }
    if let Some(ref neighbourhood) = addr.neighbourhood {
        locality_parts.push(neighbourhood.as_str());
    }
    if let Some(ref road) = addr.road {
        locality_parts.push(road.as_str());
    }
    if !locality_parts.is_empty() {
        result.locality = Some(locality_parts.join(", "));
    }

    // Water body
    result.water_body = addr
        .water
        .clone()
        .or_else(|| addr.bay.clone())
        .or_else(|| addr.sea.clone())
        .or_else(|| addr.ocean.clone())
        .or_else(|| addr.lake.clone())
        .or_else(|| addr.river.clone());

    result
}

/// Map country codes to continents (UN geoscheme)
fn country_to_continent(code: &str) -> Option<&'static str> {
    COUNTRY_TO_CONTINENT.get(code).copied()
}

lazy_static::lazy_static! {
    static ref COUNTRY_TO_CONTINENT: HashMap<&'static str, &'static str> = {
        let mut m = HashMap::new();
        // Africa
        for code in ["DZ","AO","BJ","BW","BF","BI","CV","CM","CF","TD","KM","CG","CD","CI","DJ",
                      "EG","GQ","ER","SZ","ET","GA","GM","GH","GN","GW","KE","LS","LR","LY","MG",
                      "MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW","ST","SN","SC","SL","SO",
                      "ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW","RE","YT","SH","EH"] {
            m.insert(code, "Africa");
        }
        // Antarctica
        for code in ["AQ","BV","GS","HM"] {
            m.insert(code, "Antarctica");
        }
        // Asia
        for code in ["AF","AM","AZ","BH","BD","BT","BN","KH","CN","CY","GE","HK","IN","ID","IR",
                      "IQ","IL","JP","JO","KZ","KW","KG","LA","LB","MO","MY","MV","MN","MM","NP",
                      "KP","OM","PK","PS","PH","QA","SA","SG","KR","LK","SY","TW","TJ","TH","TL",
                      "TR","TM","AE","UZ","VN","YE"] {
            m.insert(code, "Asia");
        }
        // Europe
        for code in ["AL","AD","AT","BY","BE","BA","BG","HR","CZ","DK","EE","FI","FR","DE","GR",
                      "HU","IS","IE","IT","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK",
                      "NO","PL","PT","RO","RU","SM","RS","SK","SI","ES","SE","CH","UA","GB","VA",
                      "AX","FO","GG","IM","JE","GI","SJ"] {
            m.insert(code, "Europe");
        }
        // North America
        for code in ["AI","AG","AW","BS","BB","BZ","BM","BQ","VG","CA","KY","CR","CU","CW","DM",
                      "DO","SV","GL","GD","GP","GT","HT","HN","JM","MQ","MX","MS","NI","PA","PR",
                      "BL","KN","LC","MF","PM","VC","SX","TT","TC","US","VI"] {
            m.insert(code, "North America");
        }
        // Oceania
        for code in ["AS","AU","CK","FJ","PF","GU","KI","MH","FM","NR","NC","NZ","NU","NF","MP",
                      "PW","PG","PN","WS","SB","TK","TO","TV","UM","VU","WF","CC","CX"] {
            m.insert(code, "Oceania");
        }
        // South America
        for code in ["AR","BO","BR","CL","CO","EC","FK","GF","GY","PY","PE","SR","UY","VE"] {
            m.insert(code, "South America");
        }
        m
    };
}
