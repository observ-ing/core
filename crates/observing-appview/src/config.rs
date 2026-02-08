use std::env;

/// Application configuration parsed from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub cors_origins: Vec<String>,
    pub media_proxy_url: String,
    pub taxonomy_service_url: String,
    /// URL of the TypeScript appview for internal agent RPC (transitional)
    pub ts_appview_url: String,
    /// Optional secret for internal agent RPC
    pub internal_secret: Option<String>,
    /// Public URL for production OAuth (e.g. "https://observ.ing")
    pub public_url: Option<String>,
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

        let ts_appview_url =
            env::var("TS_APPVIEW_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());

        let internal_secret = env::var("INTERNAL_SECRET").ok();

        let public_url = env::var("PUBLIC_URL").ok();

        Self {
            port,
            database_url,
            cors_origins,
            media_proxy_url,
            taxonomy_service_url,
            ts_appview_url,
            internal_secret,
            public_url,
        }
    }
}
