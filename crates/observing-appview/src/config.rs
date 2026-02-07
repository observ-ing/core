use std::env;

/// Application configuration parsed from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub cors_origins: Vec<String>,
    pub media_proxy_url: String,
    pub taxonomy_service_url: String,
    pub public_url: Option<String>,
}

impl Config {
    /// Parse configuration from environment variables
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3004);

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://localhost/observing".to_string());

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

        Self {
            port,
            database_url,
            cors_origins,
            media_proxy_url,
            taxonomy_service_url,
            public_url,
        }
    }
}
