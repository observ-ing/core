use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use atproto_identity::{IdentityResolver, Profile};
use observing_db::types::{
    CommentRow, IdentificationRow, InteractionRow, ObserverRole, ObserverRow, OccurrenceRow,
};
use serde::Serialize;
use sqlx::PgPool;
use ts_rs::TS;

use crate::taxonomy_client::TaxonomyClient;

/// Enriched occurrence ready for API response
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Occurrence", export_to = "bindings/")]
pub struct OccurrenceResponse {
    pub uri: String,
    pub cid: String,
    pub observer: ProfileSummary,
    pub observers: Vec<ObserverInfo>,
    #[ts(optional)]
    pub community_id: Option<String>,
    #[ts(optional)]
    pub effective_taxonomy: Option<EffectiveTaxonomy>,
    #[ts(type = "number")]
    pub identification_count: i64,
    pub event_date: String,
    pub location: LocationResponse,
    pub images: Vec<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub like_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub viewer_has_liked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Profile", export_to = "bindings/")]
pub struct ProfileSummary {
    pub did: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Observer", export_to = "bindings/")]
pub struct ObserverInfo {
    pub did: String,
    #[ts(as = "ObserverRole")]
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Location", export_to = "bindings/")]
pub struct LocationResponse {
    pub latitude: f64,
    pub longitude: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub uncertainty_meters: Option<i32>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct EffectiveTaxonomy {
    pub scientific_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub vernacular_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kingdom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub phylum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub genus: Option<String>,
}

/// Enriched identification with profile info
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Identification", export_to = "bindings/")]
pub struct EnrichedIdentification {
    #[serde(flatten)]
    pub row: IdentificationRow,
    pub identifier: ProfileSummary,
}

/// Enriched comment with profile info
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Comment", export_to = "bindings/")]
pub struct EnrichedComment {
    #[serde(flatten)]
    pub row: CommentRow,
    pub commenter: ProfileSummary,
}

/// Enriched interaction with profile info
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct EnrichedInteraction {
    #[serde(flatten)]
    pub row: InteractionRow,
    pub creator: ProfileSummary,
}

fn profile_summary(did: &str, profiles: &HashMap<String, Arc<Profile>>) -> ProfileSummary {
    if let Some(p) = profiles.get(did) {
        ProfileSummary {
            did: p.did.clone(),
            handle: Some(p.handle.clone()),
            display_name: p.display_name.clone(),
            avatar: p.avatar.clone(),
        }
    } else {
        ProfileSummary {
            did: did.to_string(),
            handle: None,
            display_name: None,
            avatar: None,
        }
    }
}

fn extract_images(row: &OccurrenceRow) -> Vec<String> {
    row.blob_entries()
        .iter()
        .map(|blob| format!("/media/blob/{}/{}", row.did, blob.image.ref_.cid()))
        .collect()
}

/// Enrich a batch of occurrences with profiles, likes, community IDs, and taxonomy
pub async fn enrich_occurrences(
    pool: &PgPool,
    resolver: &IdentityResolver,
    taxonomy: &TaxonomyClient,
    rows: &[OccurrenceRow],
    viewer_did: Option<&str>,
) -> Vec<OccurrenceResponse> {
    if rows.is_empty() {
        return Vec::new();
    }

    let uris: Vec<String> = rows.iter().map(|r| r.uri.clone()).collect();

    // Stage 1: Batch-fetch all DB data concurrently
    let (like_counts, viewer_likes, observers_by_uri, community_ids, identifications_by_uri) = tokio::join!(
        async {
            observing_db::likes::get_counts_for_occurrences(pool, &uris)
                .await
                .unwrap_or_default()
        },
        async {
            if let Some(did) = viewer_did {
                observing_db::likes::get_user_like_statuses(pool, &uris, did)
                    .await
                    .unwrap_or_default()
            } else {
                HashSet::new()
            }
        },
        async {
            observing_db::observers::get_for_occurrences(pool, &uris)
                .await
                .unwrap_or_default()
        },
        async {
            observing_db::identifications::get_community_ids_for_occurrences(pool, &uris)
                .await
                .unwrap_or_default()
        },
        async {
            observing_db::identifications::get_for_subjects_batch(pool, &uris)
                .await
                .unwrap_or_default()
        },
    );

    // Stage 2: Batch profile resolution (needs observer DIDs from stage 1)
    let mut all_dids: HashSet<String> = rows.iter().map(|r| r.did.clone()).collect();
    all_dids.extend(observers_by_uri.values().flatten().map(|o| o.did.clone()));
    let dids_vec: Vec<String> = all_dids.into_iter().collect();
    let profiles = resolver.get_profiles(&dids_vec).await;

    // Stage 3: Resolve taxonomy for all occurrences (HTTP fallbacks run in parallel)
    let taxonomy_futures: Vec<_> = rows
        .iter()
        .map(|row| {
            let community_id = community_ids.get(&row.uri).cloned();
            let identifications = identifications_by_uri
                .get(&row.uri)
                .cloned()
                .unwrap_or_default();
            let kingdom = row.kingdom.clone();
            async move {
                resolve_effective_taxonomy(
                    taxonomy,
                    community_id.as_deref(),
                    &identifications,
                    kingdom.as_deref(),
                )
                .await
            }
        })
        .collect();
    let taxonomies: Vec<Option<EffectiveTaxonomy>> =
        futures::future::join_all(taxonomy_futures).await;

    // Stage 4: Build responses (pure data assembly, no I/O)
    let mut results = Vec::with_capacity(rows.len());

    for (i, row) in rows.iter().enumerate() {
        let identification_count = identifications_by_uri
            .get(&row.uri)
            .map(|ids| ids.len() as i64)
            .unwrap_or(0);

        let community_id = community_ids.get(&row.uri).cloned();
        let effective_taxonomy = taxonomies[i].clone();

        let observer_rows = observers_by_uri.get(&row.uri).cloned().unwrap_or_default();
        let observer_infos: Vec<ObserverInfo> = observer_rows
            .iter()
            .map(|o| {
                let p = profile_summary(&o.did, &profiles);
                ObserverInfo {
                    did: o.did.clone(),
                    role: o.role.clone(),
                    handle: p.handle,
                    display_name: p.display_name,
                    avatar: p.avatar,
                }
            })
            .collect();

        let images = extract_images(row);

        results.push(OccurrenceResponse {
            uri: row.uri.clone(),
            cid: row.cid.clone(),
            observer: profile_summary(&row.did, &profiles),
            observers: observer_infos,
            community_id,
            effective_taxonomy,
            identification_count,
            event_date: row.event_date.to_rfc3339(),
            location: LocationResponse {
                latitude: row.latitude,
                longitude: row.longitude,
                uncertainty_meters: row.coordinate_uncertainty_meters,
            },
            images,
            created_at: row.created_at.to_rfc3339(),
            like_count: Some(*like_counts.get(&row.uri).unwrap_or(&0)),
            viewer_has_liked: viewer_did.map(|_| viewer_likes.contains(&row.uri)),
        });
    }

    results
}

/// Resolve effective taxonomy using pre-fetched data.
/// Only makes external HTTP calls (GBIF) when the DB doesn't have taxonomy info.
async fn resolve_effective_taxonomy(
    taxonomy: &TaxonomyClient,
    community_id: Option<&str>,
    identifications: &[IdentificationRow],
    occurrence_kingdom: Option<&str>,
) -> Option<EffectiveTaxonomy> {
    let effective_name = community_id?;

    // Try to find a matching identification with taxonomy info
    let matching_id = identifications
        .iter()
        .find(|id| id.scientific_name == effective_name && id.kingdom.is_some());

    if let Some(id) = matching_id {
        return Some(EffectiveTaxonomy {
            scientific_name: id.scientific_name.clone(),
            vernacular_name: id.vernacular_name.clone(),
            kingdom: id.kingdom.clone(),
            phylum: id.phylum.clone(),
            class: id.class.clone(),
            order: id.order_.clone(),
            family: id.family.clone(),
            genus: id.genus.clone(),
        });
    }

    // Fall back to GBIF lookup
    if let Some(detail) = taxonomy
        .get_by_name(effective_name, occurrence_kingdom)
        .await
        .unwrap_or(None)
    {
        return Some(EffectiveTaxonomy {
            scientific_name: detail.scientific_name,
            vernacular_name: detail.common_name,
            kingdom: detail.kingdom,
            phylum: detail.phylum,
            class: detail.class,
            order: detail.order,
            family: detail.family,
            genus: detail.genus,
        });
    }

    // Bare minimum: just the name
    Some(EffectiveTaxonomy {
        scientific_name: effective_name.to_string(),
        vernacular_name: None,
        kingdom: None,
        phylum: None,
        class: None,
        order: None,
        family: None,
        genus: None,
    })
}

/// Generic helper: resolve profiles for a slice of rows and map each into an enriched type.
async fn enrich_rows<R, E>(
    resolver: &IdentityResolver,
    rows: &[R],
    get_did: impl Fn(&R) -> &str,
    build: impl Fn(&R, ProfileSummary) -> E,
) -> Vec<E> {
    let dids: Vec<String> = rows.iter().map(|r| get_did(r).to_string()).collect();
    let profiles = resolver.get_profiles(&dids).await;
    rows.iter()
        .map(|row| build(row, profile_summary(get_did(row), &profiles)))
        .collect()
}

/// Enrich identifications with profile info
pub async fn enrich_identifications(
    resolver: &IdentityResolver,
    rows: &[IdentificationRow],
) -> Vec<EnrichedIdentification> {
    enrich_rows(
        resolver,
        rows,
        |r| &r.did,
        |row, profile| EnrichedIdentification {
            identifier: profile,
            row: row.clone(),
        },
    )
    .await
}

/// Enrich comments with profile info
pub async fn enrich_comments(
    resolver: &IdentityResolver,
    rows: &[CommentRow],
) -> Vec<EnrichedComment> {
    enrich_rows(
        resolver,
        rows,
        |r| &r.did,
        |row, profile| EnrichedComment {
            commenter: profile,
            row: row.clone(),
        },
    )
    .await
}

/// Enrich interactions with profile info
pub async fn enrich_interactions(
    resolver: &IdentityResolver,
    rows: &[InteractionRow],
) -> Vec<EnrichedInteraction> {
    enrich_rows(
        resolver,
        rows,
        |r| &r.did,
        |row, profile| EnrichedInteraction {
            creator: profile,
            row: row.clone(),
        },
    )
    .await
}

/// Enrich observers with profile info
pub async fn enrich_observers(
    resolver: &IdentityResolver,
    rows: &[ObserverRow],
) -> Vec<ObserverInfo> {
    let dids: Vec<String> = rows.iter().map(|r| r.did.clone()).collect();
    let profiles = resolver.get_profiles(&dids).await;

    rows.iter()
        .map(|o| {
            let p = profile_summary(&o.did, &profiles);
            ObserverInfo {
                did: o.did.clone(),
                role: o.role.clone(),
                handle: p.handle,
                display_name: p.display_name,
                avatar: p.avatar,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use observing_db::types::{BlobEntry, BlobImage, BlobRef};

    fn make_row(media: Option<serde_json::Value>) -> OccurrenceRow {
        OccurrenceRow {
            uri: "at://did:plc:test/bio.lexicons.temp.occurrence/1".into(),
            cid: "cid".into(),
            did: "did:plc:test".into(),
            scientific_name: None,
            event_date: Utc::now(),
            latitude: 0.0,
            longitude: 0.0,
            coordinate_uncertainty_meters: None,
            associated_media: media,
            recorded_by: None,
            taxon_id: None,
            taxon_rank: None,
            vernacular_name: None,
            kingdom: None,
            phylum: None,
            class: None,
            order_: None,
            family: None,
            genus: None,
            created_at: Utc::now(),
            distance_meters: None,
            source: None,
            observer_role: None,
        }
    }

    fn blob_entry(cid: &str, mime: &str, ref_style: &str) -> BlobEntry {
        let ref_ = match ref_style {
            "link" => BlobRef::Link {
                link: cid.to_string(),
            },
            _ => BlobRef::Bare(cid.to_string()),
        };
        BlobEntry {
            image: BlobImage {
                ref_,
                mime_type: mime.to_string(),
            },
            alt: None,
        }
    }

    fn blobs_to_json(entries: Vec<BlobEntry>) -> serde_json::Value {
        serde_json::to_value(entries).unwrap()
    }

    #[test]
    fn test_extract_images_no_media() {
        let row = make_row(None);
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_non_array() {
        let row = make_row(Some(serde_json::json!("not an array")));
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_empty_array() {
        let row = make_row(Some(blobs_to_json(vec![])));
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_with_link() {
        let row = make_row(Some(blobs_to_json(vec![blob_entry(
            "bafkreiabc123",
            "image/jpeg",
            "link",
        )])));
        let images = extract_images(&row);
        assert_eq!(images, vec!["/media/blob/did:plc:test/bafkreiabc123"]);
    }

    #[test]
    fn test_extract_images_with_string_ref() {
        let row = make_row(Some(blobs_to_json(vec![blob_entry(
            "bafkreixyz789",
            "image/jpeg",
            "bare",
        )])));
        let images = extract_images(&row);
        assert_eq!(images, vec!["/media/blob/did:plc:test/bafkreixyz789"]);
    }

    #[test]
    fn test_extract_images_multiple() {
        let row = make_row(Some(blobs_to_json(vec![
            blob_entry("cid1", "image/jpeg", "link"),
            blob_entry("cid2", "image/png", "link"),
        ])));
        let images = extract_images(&row);
        assert_eq!(images.len(), 2);
        assert!(images.contains(&"/media/blob/did:plc:test/cid1".to_string()));
        assert!(images.contains(&"/media/blob/did:plc:test/cid2".to_string()));
    }

    #[test]
    fn test_extract_images_missing_image_field() {
        // Invalid blob entries that can't deserialize just get skipped by blob_entries()
        let row = make_row(Some(serde_json::json!([
            {"notImage": {"ref": {"$link": "cid1"}}}
        ])));
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_missing_ref_field() {
        let row = make_row(Some(serde_json::json!([
            {"image": {"mimeType": "image/jpeg"}}
        ])));
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_blob_entry_roundtrip_link_format() {
        let json_str =
            r#"{"image":{"ref":{"$link":"bafkreiabc123"},"mimeType":"image/jpeg"},"alt":""}"#;
        let entry: BlobEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.image.ref_.cid(), "bafkreiabc123");
        assert_eq!(entry.image.mime_type, "image/jpeg");
    }

    #[test]
    fn test_blob_entry_roundtrip_bare_format() {
        let json_str = r#"{"image":{"ref":"bafkreixyz789","mimeType":"image/jpeg"}}"#;
        let entry: BlobEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.image.ref_.cid(), "bafkreixyz789");
    }

    #[test]
    fn test_profile_summary_found() {
        let mut profiles = HashMap::new();
        profiles.insert(
            "did:plc:alice".to_string(),
            Arc::new(Profile {
                did: "did:plc:alice".to_string(),
                handle: "alice.bsky.social".to_string(),
                display_name: Some("Alice".to_string()),
                description: None,
                avatar: Some("https://cdn.example.com/avatar.jpg".to_string()),
                banner: None,
                followers_count: None,
                follows_count: None,
                posts_count: None,
            }),
        );
        let summary = profile_summary("did:plc:alice", &profiles);
        assert_eq!(summary.did, "did:plc:alice");
        assert_eq!(summary.handle.as_deref(), Some("alice.bsky.social"));
        assert_eq!(summary.display_name.as_deref(), Some("Alice"));
        assert!(summary.avatar.is_some());
    }

    #[test]
    fn test_profile_summary_not_found() {
        let profiles = HashMap::new();
        let summary = profile_summary("did:plc:unknown", &profiles);
        assert_eq!(summary.did, "did:plc:unknown");
        assert!(summary.handle.is_none());
        assert!(summary.display_name.is_none());
        assert!(summary.avatar.is_none());
    }
}
