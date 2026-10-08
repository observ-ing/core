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
    /// iNaturalist cross-posting. `None` turns the feature off.
    pub inat: Option<InatConfig>,
}

/// Settings for cross-posting to iNaturalist, present when an iNaturalist
/// OAuth application is configured.
#[derive(Clone, PartialEq)]
pub struct InatConfig {
    pub client_id: String,
    pub client_secret: String,
    /// Base of observation permalinks, e.g. `https://www.inaturalist.org`.
    pub site_url: String,
    /// Base of the v2 API, e.g. `https://api.inaturalist.org/v2`.
    pub api_url: String,
}

impl std::fmt::Debug for InatConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InatConfig")
            .field("client_id", &self.client_id)
            .field("client_secret", &"<redacted>")
            .field("site_url", &self.site_url)
            .field("api_url", &self.api_url)
            .finish()
    }
}

impl InatConfig {
    const DEFAULT_SITE_URL: &'static str = "https://www.inaturalist.org";
    const DEFAULT_API_URL: &'static str = "https://api.inaturalist.org/v2";

    /// Build from the `INAT_CLIENT_ID`, `INAT_CLIENT_SECRET`, `INAT_SITE_URL`,
    /// and `INAT_API_URL` values. Both the ID and the secret are required;
    /// blank values count as unset, as they do for `PUBLIC_URL`.
    fn from_vars(
        client_id: Option<String>,
        client_secret: Option<String>,
        site_url: Option<String>,
        api_url: Option<String>,
    ) -> Option<Self> {
        let set = |value: Option<String>| {
            value
                .map(|v| v.trim().trim_end_matches('/').to_string())
                .filter(|v| !v.is_empty())
        };
        Some(Self {
            client_id: set(client_id)?,
            client_secret: set(client_secret)?,
            site_url: set(site_url).unwrap_or_else(|| Self::DEFAULT_SITE_URL.to_string()),
            api_url: set(api_url).unwrap_or_else(|| Self::DEFAULT_API_URL.to_string()),
        })
    }
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

        let species_id_service_url = env::var("SPECIES_ID_SERVICE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());
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

        let inat = InatConfig::from_vars(
            env::var("INAT_CLIENT_ID").ok(),
            env::var("INAT_CLIENT_SECRET").ok(),
            env::var("INAT_SITE_URL").ok(),
            env::var("INAT_API_URL").ok(),
        );

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
            inat,
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

    fn some(value: &str) -> Option<String> {
        Some(value.to_string())
    }

    #[test]
    fn inat_is_off_without_both_the_id_and_the_secret() {
        assert_eq!(InatConfig::from_vars(None, None, None, None), None);
        assert_eq!(InatConfig::from_vars(some("id"), None, None, None), None);
        assert_eq!(
            InatConfig::from_vars(None, some("secret"), None, None),
            None
        );
        assert_eq!(
            InatConfig::from_vars(some("id"), some("  "), None, None),
            None
        );
    }

    #[test]
    fn inat_defaults_to_the_production_urls() {
        let config =
            InatConfig::from_vars(some("id"), some("secret"), None, some(" ")).expect("configured");
        assert_eq!(config.client_id, "id");
        assert_eq!(config.client_secret, "secret");
        assert_eq!(config.site_url, "https://www.inaturalist.org");
        assert_eq!(config.api_url, "https://api.inaturalist.org/v2");
    }

    #[test]
    fn inat_urls_can_be_overridden_and_lose_a_trailing_slash() {
        let config = InatConfig::from_vars(
            some("id"),
            some("secret"),
            some("http://localhost:3000/"),
            some("http://localhost:4000/v2/"),
        )
        .expect("configured");
        assert_eq!(config.site_url, "http://localhost:3000");
        assert_eq!(config.api_url, "http://localhost:4000/v2");
    }

    #[test]
    fn inat_debug_output_hides_the_secret() {
        let config =
            InatConfig::from_vars(some("id"), some("hunter2"), None, None).expect("configured");
        assert!(!format!("{config:?}").contains("hunter2"));
    }
}
