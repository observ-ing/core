// --- Occurrence query defaults ---

/// Default number of occurrences returned by the nearby endpoint.
pub const DEFAULT_NEARBY_LIMIT: i64 = 100;

/// Maximum number of occurrences the nearby endpoint will return.
pub const MAX_NEARBY_LIMIT: i64 = 1000;

/// Default search radius (in meters) for the nearby endpoint.
pub const DEFAULT_NEARBY_RADIUS: f64 = 10_000.0;

/// Default number of occurrences returned by the bounding-box endpoint.
pub const DEFAULT_BBOX_LIMIT: i64 = 1000;

/// Maximum number of points returned by the GeoJSON endpoint.
pub const MAX_GEOJSON_LIMIT: i64 = 10_000;

/// Default coordinate uncertainty (in meters) assigned to new occurrences.
pub const DEFAULT_COORDINATE_UNCERTAINTY: i32 = 50;

// --- Feed / pagination defaults ---

/// Default page size for feed-style endpoints (explore, home, profile, taxon).
pub const DEFAULT_FEED_LIMIT: i64 = 20;

/// Maximum page size for feed-style endpoints.
pub const MAX_FEED_LIMIT: i64 = 100;

/// Default page size for the notifications list.
pub const DEFAULT_NOTIFICATION_LIMIT: i64 = 20;

/// Maximum page size for the notifications list.
pub const MAX_NOTIFICATION_LIMIT: i64 = 50;

// --- Validation limits ---

/// Maximum allowed length of a comment body (in characters).
pub const MAX_COMMENT_LENGTH: usize = 3000;

/// Maximum allowed length of a scientific name (in characters).
pub const MAX_SCIENTIFIC_NAME_LENGTH: usize = 256;

/// Maximum allowed length of an interaction type string (in characters).
pub const MAX_INTERACTION_TYPE_LENGTH: usize = 64;

/// Minimum length for search queries (taxonomy and actor search).
pub const MIN_SEARCH_QUERY_LENGTH: usize = 2;

/// Number of results returned by the actor search endpoint.
pub const ACTOR_SEARCH_LIMIT: u8 = 8;

// --- Interaction defaults ---

/// Default direction value for species interactions.
pub const DEFAULT_INTERACTION_DIRECTION: &str = "AtoB";
