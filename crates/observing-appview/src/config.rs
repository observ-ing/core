use std::env;

/// Application configuration parsed from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub cors_origins: Vec<String>,
    pub media_proxy_url: String,
    pub taxonomy_service_url: String,
    /// Public URL for production OAuth (e.g. "https://observ.ing")
    pub public_url: Option<String>,
    /// DIDs to hide from all feeds (e.g. test accounts)
    pub hidden_dids: Vec<String>,
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
                ]
            });

        let media_proxy_url =
            env::var("MEDIA_PROXY_URL").unwrap_or_else(|_| "http://localhost:3001".to_string());

        let taxonomy_service_url = env::var("TAXONOMY_SERVICE_URL")
            .unwrap_or_else(|_| "http://localhost:3003".to_string());

        let public_url = env::var("PUBLIC_URL").ok();

        let hidden_dids = env::var("HIDDEN_DIDS")
            .map(|s| parse_hidden_dids(&s))
            .unwrap_or_default();

        Self {
            port,
            database_url,
            cors_origins,
            media_proxy_url,
            taxonomy_service_url,
            public_url,
            hidden_dids,
        }
    }
}

/// Parse a comma-separated list of DIDs, trimming whitespace and filtering empties.
fn parse_hidden_dids(input: &str) -> Vec<String> {
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
    fn test_parse_hidden_dids_single() {
        let result = parse_hidden_dids("did:plc:abc123");
        assert_eq!(result, vec!["did:plc:abc123"]);
    }

    #[test]
    fn test_parse_hidden_dids_multiple() {
        let result = parse_hidden_dids("did:plc:abc,did:plc:def,did:plc:ghi");
        assert_eq!(result, vec!["did:plc:abc", "did:plc:def", "did:plc:ghi"]);
    }

    #[test]
    fn test_parse_hidden_dids_with_whitespace() {
        let result = parse_hidden_dids("  did:plc:abc , did:plc:def  ");
        assert_eq!(result, vec!["did:plc:abc", "did:plc:def"]);
    }

    #[test]
    fn test_parse_hidden_dids_empty_string() {
        let result = parse_hidden_dids("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_hidden_dids_trailing_comma() {
        let result = parse_hidden_dids("did:plc:abc,");
        assert_eq!(result, vec!["did:plc:abc"]);
    }

    #[test]
    fn test_parse_hidden_dids_only_commas() {
        let result = parse_hidden_dids(",,,");
        assert!(result.is_empty());
    }
}
