use serde::Deserialize;

/// Location fields populated by reverse geocoding
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
pub(crate) struct NominatimResponse {
    pub(crate) address: NominatimAddress,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct NominatimAddress {
    pub(crate) country: Option<String>,
    pub(crate) country_code: Option<String>,
    pub(crate) state: Option<String>,
    pub(crate) county: Option<String>,
    pub(crate) city: Option<String>,
    pub(crate) town: Option<String>,
    pub(crate) village: Option<String>,
    pub(crate) municipality: Option<String>,
    pub(crate) suburb: Option<String>,
    pub(crate) neighbourhood: Option<String>,
    pub(crate) road: Option<String>,
    pub(crate) water: Option<String>,
    pub(crate) bay: Option<String>,
    pub(crate) sea: Option<String>,
    pub(crate) ocean: Option<String>,
    pub(crate) lake: Option<String>,
    pub(crate) river: Option<String>,
}
