//! AT Protocol types for DID resolution

use serde::Deserialize;

/// Response from the PLC directory for DID resolution
#[derive(Debug, Deserialize)]
pub struct PlcDirectoryResponse {
    pub service: Option<Vec<PlcService>>,
}

#[derive(Debug, Deserialize)]
pub struct PlcService {
    pub id: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    pub service_type: String,
    #[serde(rename = "serviceEndpoint")]
    pub service_endpoint: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plc_directory_response_deserialization() {
        let json = r##"{
            "service": [
                {
                    "id": "#atproto_pds",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://bsky.social"
                }
            ]
        }"##;

        let response: PlcDirectoryResponse = serde_json::from_str(json).unwrap();
        assert!(response.service.is_some());
        let services = response.service.unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].service_endpoint, "https://bsky.social");
    }
}
