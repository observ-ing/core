use std::env;

/// Application configuration parsed from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub cors_origins: Vec<String>,
    /// URL for the species identification service (optional)
    pub species_id_service_url: Option<String>,
    /// Public URL for production OAuth (e.g. "https://observ.ing")
    pub public_url: Option<String>,
    /// DIDs to hide from all feeds (e.g. test accounts)
    pub hidden_dids: Vec<String>,
    /// DIDs allowed to access admin routes. When empty, admin routes return 503.
    pub admin_dids: Vec<String>,
    /// Handle for the AI identification bot account (e.g. "ai.observ.ing.bsky.social").
    /// When unset (along with the other AI_BLUESKY_* vars), the auto-AI-ID feature
    /// is disabled.
    pub ai_bluesky_handle: Option<String>,
    pub ai_bluesky_app_password: Option<String>,
    /// Expected DID for the AI account; login result is verified against this.
    pub ai_bluesky_did: Option<String>,
    /// PDS URL for the AI account. Defaults to https://bsky.social.
    pub ai_bluesky_pds_url: String,
    /// Minimum cosine-similarity confidence for the top species-id suggestion
    /// before the AI bot posts an identification.
    pub ai_id_min_confidence: f32,
    /// When true, suppress AI identifications whose top suggestion is known
    /// to be out-of-range at the observation location.
    pub ai_id_in_range_only: bool,
}

impl Config {
    /// Parse configuration from environment variables
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3004);

        // Support both DATABASE_URL and separate DB_* environment variables
        // (for compatibility with Cloud SQL socket connections)
        let database_url = if let Ok(url) = env::var("DATABASE_URL") {
            url
        } else if let Ok(host) = env::var("DB_HOST") {
            let name = env::var("DB_NAME").unwrap_or_else(|_| "observing".to_string());
            let user = env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string());
            let password = env::var("DB_PASSWORD").unwrap_or_default();

            if host.starts_with("/cloudsql/") {
                // Unix socket connection for Cloud SQL
                format!(
                    "postgresql://{}:{}@localhost/{}?host={}",
                    user, password, name, host
                )
            } else {
                // Regular TCP connection
                let port = env::var("DB_PORT").unwrap_or_else(|_| "5432".to_string());
                format!(
                    "postgresql://{}:{}@{}:{}/{}",
                    user, password, host, port, name
                )
            }
        } else {
            "postgres://localhost/observing".to_string()
        };

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

        let public_url = env::var("PUBLIC_URL").ok();

        let hidden_dids = env::var("HIDDEN_DIDS")
            .map(|s| parse_did_list(&s))
            .unwrap_or_default();

        let admin_dids = env::var("ADMIN_DIDS")
            .map(|s| parse_did_list(&s))
            .unwrap_or_default();

        let ai_bluesky_handle = env::var("AI_BLUESKY_HANDLE")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let ai_bluesky_app_password = env::var("AI_BLUESKY_APP_PASSWORD")
            .ok()
            .filter(|s| !s.is_empty());
        let ai_bluesky_did = env::var("AI_BLUESKY_DID")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let ai_bluesky_pds_url =
            env::var("AI_BLUESKY_PDS_URL").unwrap_or_else(|_| "https://bsky.social".to_string());
        let ai_id_min_confidence = env::var("AI_ID_MIN_CONFIDENCE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.15);
        let ai_id_in_range_only = env::var("AI_ID_IN_RANGE_ONLY")
            .map(|s| matches!(s.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        Self {
            port,
            database_url,
            cors_origins,
            species_id_service_url,
            public_url,
            hidden_dids,
            admin_dids,
            ai_bluesky_handle,
            ai_bluesky_app_password,
            ai_bluesky_did,
            ai_bluesky_pds_url,
            ai_id_min_confidence,
            ai_id_in_range_only,
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
