use std::env;

/// Application configuration parsed from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub cors_origins: Vec<String>,
    /// URL for the species identification service (optional)
    pub species_id_service_url: Option<String>,
    /// URL for the faster, lower-latency species-id service used by the live
    /// camera loop (ViT-L). Optional — when unset, live requests fall back to
    /// the full-accuracy `species_id_service_url`.
    pub species_id_live_service_url: Option<String>,
    /// Base URL for the tap-ingester service (optional). When set, its
    /// runtime interface is exposed as `ingester/*` tables in the admin
    /// browser; when unset, those tables are simply not registered.
    pub ingester_url: Option<String>,
    /// Public URL for production OAuth (e.g. "https://observ.ing")
    pub public_url: Option<String>,
    /// DIDs to hide from all feeds (e.g. test accounts)
    pub hidden_dids: Vec<String>,
    /// DIDs allowed to access admin routes. When empty, admin routes return 503.
    pub admin_dids: Vec<String>,
}

impl Config {
    /// Parse configuration from environment variables
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3004);

        // DATABASE_URL, else assembled from the DB_* vars (Cloud SQL socket
        // aware), else a local default.
        let database_url = pg_url_env::database_url_from_env("observing")
            .unwrap_or_else(|| "postgres://localhost/observing".to_string());

        let cors_origins = env::var("CORS_ORIGINS")
            .map(|s| s.split(',').map(|o| o.trim().to_string()).collect())
            .unwrap_or_else(|_| {
                vec![
                    "http://localhost:3000".to_string(),
                    "http://localhost:5173".to_string(),
                    // Capacitor WebView origins on Android (default and
                    // legacy) — needed when the bundled APK calls the
                    // appview cross-origin.
                    "https://localhost".to_string(),
                    "capacitor://localhost".to_string(),
                ]
            });

        let species_id_service_url = env::var("SPECIES_ID_SERVICE_URL").ok();
        let species_id_live_service_url = env::var("SPECIES_ID_LIVE_SERVICE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let ingester_url = env::var("INGESTER_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());

        // Treat an empty/whitespace PUBLIC_URL (e.g. `PUBLIC_URL=` in a shell
        // or process-compose) as unset. Otherwise `Some("")` takes the
        // production OAuth path and builds a protocol-less redirect_uri, which
        // the PDS rejects with a cryptic 400 invalid_request in local dev.
        let public_url = env::var("PUBLIC_URL").ok().filter(|s| !s.trim().is_empty());

        let hidden_dids = env::var("HIDDEN_DIDS")
            .map(|s| parse_did_list(&s))
            .unwrap_or_default();

        let admin_dids = env::var("ADMIN_DIDS")
            .map(|s| parse_did_list(&s))
            .unwrap_or_default();

        Self {
            port,
            database_url,
            cors_origins,
            species_id_service_url,
            species_id_live_service_url,
            ingester_url,
            public_url,
            hidden_dids,
            admin_dids,
        }
    }
}

/// Parse a comma-separated list of DIDs, trimming whitespace and filtering empties.
fn parse_did_list(input: &str) -> Vec<String> {
    input
        .split(',')
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_did_list_single() {
        let result = parse_did_list("did:plc:abc123");
        assert_eq!(result, vec!["did:plc:abc123"]);
    }

    #[test]
    fn test_parse_did_list_multiple() {
        let result = parse_did_list("did:plc:abc,did:plc:def,did:plc:ghi");
        assert_eq!(result, vec!["did:plc:abc", "did:plc:def", "did:plc:ghi"]);
    }

    #[test]
    fn test_parse_did_list_with_whitespace() {
        let result = parse_did_list("  did:plc:abc , did:plc:def  ");
        assert_eq!(result, vec!["did:plc:abc", "did:plc:def"]);
    }

    #[test]
    fn test_parse_did_list_empty_string() {
        let result = parse_did_list("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_did_list_trailing_comma() {
        let result = parse_did_list("did:plc:abc,");
        assert_eq!(result, vec!["did:plc:abc"]);
    }

    #[test]
    fn test_parse_did_list_only_commas() {
        let result = parse_did_list(",,,");
        assert!(result.is_empty());
    }
}
