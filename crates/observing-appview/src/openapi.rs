//! OpenAPI description of the appview's HTTP API, generated from the
//! `#[utoipa::path]` annotations on the route handlers.
//!
//! Served at `/api/openapi.json` with a Swagger UI at `/api/docs`, and
//! snapshotted to `docs/openapi.json` so API changes show up in review. The
//! `openapi_snapshot_is_current` test fails when the snapshot is stale.
//!
//! A new route needs its handler annotated and listed in `paths(...)` below.
//! The admin browser (`/admin/*`) is deliberately left out.

use utoipa::openapi::security::{ApiKey, ApiKeyValue, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::routes;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Observ.ing API",
        description = "HTTP API behind [observ.ing](https://observ.ing), a biodiversity \
            observation app built on the AT Protocol.\n\n\
            Reads come from the appview's index of the network. Writes go to the \
            signed-in user's PDS as AT Protocol records, then reach the index via the \
            firehose, so a newly written record can take a moment to appear in reads.\n\n\
            Authentication is the `session_did` cookie set by the OAuth flow \
            (`/oauth/login`). Endpoints that accept it optionally use it to fill in \
            viewer-specific fields such as `viewerHasLiked`.",
    ),
    paths(
        routes::health::health,
        routes::oauth::login,
        routes::oauth::callback,
        routes::oauth::logout,
        routes::oauth::me,
        routes::oauth::client_metadata,
        routes::occurrences::read::get_nearby,
        routes::occurrences::read::get_feed,
        routes::occurrences::read::get_bbox,
        routes::occurrences::read::get_geojson,
        routes::occurrences::read::get_occurrence,
        routes::occurrences::write::create_occurrence,
        routes::occurrences::write::update_occurrence,
        routes::occurrences::write::delete_occurrence,
        routes::feeds::get_explore,
        routes::feeds::get_home,
        routes::profiles::get_profile_feed,
        routes::identifications::get_for_occurrence,
        routes::identifications::create_identification,
        routes::identifications::delete_identification,
        routes::comments::create_comment,
        routes::likes::create_like,
        routes::likes::delete_like,
        routes::interactions::get_for_occurrence,
        routes::interactions::create_interaction,
        routes::notifications::list,
        routes::notifications::unread_count,
        routes::notifications::mark_read,
        routes::preferences::get_preferences,
        routes::preferences::update_preferences,
        routes::species_id::identify,
        routes::species_id::status,
        routes::taxonomy::search,
        routes::taxonomy::validate,
        routes::taxonomy::get_taxon_by_kingdom_name,
        routes::taxonomy::get_children_by_kingdom_name,
        routes::taxonomy::get_taxon_occurrences_by_kingdom_name,
        routes::taxonomy::get_taxon_by_id,
        routes::taxonomy::get_taxon_occurrences_by_id,
        routes::heic::heic_to_jpeg,
        routes::media::health,
        routes::media::get_blob,
        routes::media::get_thumb,
    ),
    modifiers(&SessionCookie),
    tags(
        (name = "occurrences", description = "Observations of an organism at a place and time"),
        (name = "feeds", description = "Paginated occurrence feeds"),
        (name = "identifications", description = "Taxon identifications of occurrences"),
        (name = "comments", description = "Discussion on occurrences"),
        (name = "likes", description = "Likes on occurrences"),
        (name = "interactions", description = "Species interactions between two subjects"),
        (name = "profiles", description = "User profiles and activity"),
        (name = "notifications", description = "Activity on the viewer's occurrences"),
        (name = "preferences", description = "Per-user app settings"),
        (name = "taxonomy", description = "Taxon lookup, backed by GBIF and Wikidata"),
        (name = "species-id", description = "AI species identification from photos"),
        (name = "media", description = "Image blobs and conversion"),
        (name = "auth", description = "AT Protocol OAuth sign-in"),
        (name = "meta", description = "Service health"),
    ),
)]
pub struct ApiDoc;

/// Registers the `session` security scheme that handlers reference.
struct SessionCookie;

impl Modify for SessionCookie {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "session",
            SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::with_description(
                "session_did",
                "Set by the OAuth callback after signing in via `/oauth/login`.",
            ))),
        );
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    /// utoipa defaults an operation's id to its handler's name, and handler
    /// names like `get_for_occurrence` repeat across route modules. Duplicate
    /// ids break generated clients, so give clashing handlers an explicit
    /// `operation_id`.
    #[test]
    fn operation_ids_are_unique() {
        let doc = ApiDoc::openapi();
        let mut seen = HashSet::new();
        for (path, item) in &doc.paths.paths {
            for op in [&item.get, &item.put, &item.post, &item.delete]
                .into_iter()
                .flatten()
            {
                let id = op.operation_id.as_deref().unwrap_or_default();
                assert!(seen.insert(id), "duplicate operationId `{id}` ({path})");
            }
        }
    }

    const SNAPSHOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/openapi.json");

    /// Keeps `docs/openapi.json` in sync with the code. Regenerate with
    /// `UPDATE_OPENAPI=1 cargo test -p observing-appview openapi_snapshot`.
    #[test]
    fn openapi_snapshot_is_current() {
        let generated = ApiDoc::openapi()
            .to_pretty_json()
            .expect("OpenAPI document serializes")
            + "\n";

        if std::env::var_os("UPDATE_OPENAPI").is_some() {
            std::fs::write(SNAPSHOT, &generated).expect("write docs/openapi.json");
            return;
        }

        let committed = std::fs::read_to_string(SNAPSHOT).unwrap_or_default();
        assert!(
            committed == generated,
            "docs/openapi.json is out of date. Regenerate it with \
             `UPDATE_OPENAPI=1 cargo test -p observing-appview openapi_snapshot`."
        );
    }
}
