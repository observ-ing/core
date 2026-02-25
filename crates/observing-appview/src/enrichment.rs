use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use atproto_identity::{IdentityResolver, Profile};
use observing_db::types::{
    CommentRow, IdentificationRow, InteractionRow, ObserverRole, OccurrenceRow,
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
    pub subjects: Vec<SubjectResponse>,
    pub event_date: String,
    pub location: LocationResponse,
    #[ts(optional)]
    pub verbatim_locality: Option<String>,
    #[ts(optional)]
    pub occurrence_remarks: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub continent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub country_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub state_province: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub county: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub municipality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub locality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub water_body: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Subject", export_to = "bindings/")]
pub struct SubjectResponse {
    #[serde(rename = "index")]
    pub subject_index: i32,
    #[ts(type = "number")]
    pub identification_count: i64,
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
    let Some(ref media) = row.associated_media else {
        return Vec::new();
    };

    let blobs = match media {
        serde_json::Value::Array(arr) => arr.clone(),
        _ => return Vec::new(),
    };

    blobs
        .iter()
        .filter_map(|blob| {
            let image = blob.get("image")?;
            let ref_val = image.get("ref")?;
            let cid = if let Some(link) = ref_val.get("$link") {
                link.as_str()?.to_string()
            } else if let Some(s) = ref_val.as_str() {
                s.to_string()
            } else {
                return None;
            };
            Some(format!("/media/blob/{}/{}", row.did, cid))
        })
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

    // Stage 1: Fetch like data
    let like_counts = observing_db::likes::get_counts_for_occurrences(pool, &uris)
        .await
        .unwrap_or_default();

    let viewer_likes: HashSet<String> = if let Some(did) = viewer_did {
        observing_db::likes::get_user_like_statuses(pool, &uris, did)
            .await
            .unwrap_or_default()
    } else {
        HashSet::new()
    };

    // Stage 2: Fetch observers for each occurrence
    let mut observers_by_uri: HashMap<String, Vec<observing_db::types::ObserverRow>> =
        HashMap::new();
    for row in rows {
        if let Ok(observers) = observing_db::observers::get_for_occurrence(pool, &row.uri).await {
            observers_by_uri.insert(row.uri.clone(), observers);
        }
    }

    // Stage 3: Batch profile resolution
    let mut all_dids: HashSet<String> = rows.iter().map(|r| r.did.clone()).collect();
    all_dids.extend(observers_by_uri.values().flatten().map(|o| o.did.clone()));
    let dids_vec: Vec<String> = all_dids.into_iter().collect();
    let profiles = resolver.get_profiles(&dids_vec).await;

    // Build responses
    let mut results = Vec::with_capacity(rows.len());

    for row in rows {
        // Stage 4: Get subjects
        let subject_data = observing_db::identifications::get_subjects(pool, &row.uri)
            .await
            .unwrap_or_default();

        // Ensure subject 0 is present
        let has_subject_0 = subject_data.iter().any(|s| s.subject_index == 0);

        let mut subjects: Vec<SubjectResponse> = Vec::new();
        if !has_subject_0 {
            subjects.push(SubjectResponse {
                subject_index: 0,
                identification_count: 0,
            });
        }

        for si in &subject_data {
            subjects.push(SubjectResponse {
                subject_index: si.subject_index,
                identification_count: si.identification_count,
            });
        }

        // Subject 0 community ID
        let community_id = observing_db::identifications::get_community_id(pool, &row.uri, 0)
            .await
            .unwrap_or(None);

        // Stage 6: Effective taxonomy
        let effective_taxonomy = resolve_effective_taxonomy(
            pool,
            taxonomy,
            &row.uri,
            community_id.as_deref(),
            row.kingdom.as_deref(),
        )
        .await;

        // Stage 7: Build observer info with profiles
        let observer_rows = observers_by_uri.get(&row.uri).cloned().unwrap_or_default();
        let observer_infos: Vec<ObserverInfo> = observer_rows
            .iter()
            .map(|o| {
                let p = profiles.get(&o.did);
                ObserverInfo {
                    did: o.did.clone(),
                    role: o.role.clone(),
                    handle: p.map(|p| p.handle.clone()),
                    display_name: p.and_then(|p| p.display_name.clone()),
                    avatar: p.and_then(|p| p.avatar.clone()),
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
            subjects,
            event_date: row.event_date.to_rfc3339(),
            location: LocationResponse {
                latitude: row.latitude,
                longitude: row.longitude,
                uncertainty_meters: row.coordinate_uncertainty_meters,
                continent: row.continent.clone(),
                country: row.country.clone(),
                country_code: row.country_code.clone(),
                state_province: row.state_province.clone(),
                county: row.county.clone(),
                municipality: row.municipality.clone(),
                locality: row.locality.clone(),
                water_body: row.water_body.clone(),
            },
            verbatim_locality: row.verbatim_locality.clone(),
            occurrence_remarks: row.occurrence_remarks.clone(),
            images,
            created_at: row.created_at.to_rfc3339(),
            like_count: Some(*like_counts.get(&row.uri).unwrap_or(&0)),
            viewer_has_liked: viewer_did.map(|_| viewer_likes.contains(&row.uri)),
        });
    }

    results
}

/// Resolve effective taxonomy from community ID consensus
async fn resolve_effective_taxonomy(
    pool: &PgPool,
    taxonomy: &TaxonomyClient,
    occurrence_uri: &str,
    community_id: Option<&str>,
    occurrence_kingdom: Option<&str>,
) -> Option<EffectiveTaxonomy> {
    let effective_name = community_id?;

    // Try to find a matching identification with taxonomy info
    let identifications = observing_db::identifications::get_for_subject(pool, occurrence_uri, 0)
        .await
        .unwrap_or_default();

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

/// Enrich identifications with profile info
pub async fn enrich_identifications(
    resolver: &IdentityResolver,
    rows: &[IdentificationRow],
) -> Vec<EnrichedIdentification> {
    let dids: Vec<String> = rows.iter().map(|r| r.did.clone()).collect();
    let profiles = resolver.get_profiles(&dids).await;

    rows.iter()
        .map(|row| EnrichedIdentification {
            identifier: profile_summary(&row.did, &profiles),
            row: row.clone(),
        })
        .collect()
}

/// Enrich comments with profile info
pub async fn enrich_comments(
    resolver: &IdentityResolver,
    rows: &[CommentRow],
) -> Vec<EnrichedComment> {
    let dids: Vec<String> = rows.iter().map(|r| r.did.clone()).collect();
    let profiles = resolver.get_profiles(&dids).await;

    rows.iter()
        .map(|row| EnrichedComment {
            commenter: profile_summary(&row.did, &profiles),
            row: row.clone(),
        })
        .collect()
}

/// Enrich interactions with profile info
pub async fn enrich_interactions(
    resolver: &IdentityResolver,
    rows: &[InteractionRow],
) -> Vec<EnrichedInteraction> {
    let dids: Vec<String> = rows.iter().map(|r| r.did.clone()).collect();
    let profiles = resolver.get_profiles(&dids).await;

    rows.iter()
        .map(|row| EnrichedInteraction {
            creator: profile_summary(&row.did, &profiles),
            row: row.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    fn make_row(media: Option<serde_json::Value>) -> OccurrenceRow {
        OccurrenceRow {
            uri: "at://did:plc:test/org.rwell.test.occurrence/1".into(),
            cid: "cid".into(),
            did: "did:plc:test".into(),
            scientific_name: None,
            event_date: Utc::now(),
            latitude: 0.0,
            longitude: 0.0,
            coordinate_uncertainty_meters: None,
            continent: None,
            country: None,
            country_code: None,
            state_province: None,
            county: None,
            municipality: None,
            locality: None,
            water_body: None,
            verbatim_locality: None,
            occurrence_remarks: None,
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

    #[test]
    fn test_extract_images_no_media() {
        let row = make_row(None);
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_non_array() {
        let row = make_row(Some(json!("not an array")));
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_empty_array() {
        let row = make_row(Some(json!([])));
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_with_link() {
        let row = make_row(Some(json!([
            {"image": {"ref": {"$link": "bafkreiabc123"}, "mimeType": "image/jpeg"}}
        ])));
        let images = extract_images(&row);
        assert_eq!(images, vec!["/media/blob/did:plc:test/bafkreiabc123"]);
    }

    #[test]
    fn test_extract_images_with_string_ref() {
        let row = make_row(Some(json!([
            {"image": {"ref": "bafkreixyz789", "mimeType": "image/jpeg"}}
        ])));
        let images = extract_images(&row);
        assert_eq!(images, vec!["/media/blob/did:plc:test/bafkreixyz789"]);
    }

    #[test]
    fn test_extract_images_multiple() {
        let row = make_row(Some(json!([
            {"image": {"ref": {"$link": "cid1"}, "mimeType": "image/jpeg"}},
            {"image": {"ref": {"$link": "cid2"}, "mimeType": "image/png"}}
        ])));
        let images = extract_images(&row);
        assert_eq!(images.len(), 2);
        assert!(images.contains(&"/media/blob/did:plc:test/cid1".to_string()));
        assert!(images.contains(&"/media/blob/did:plc:test/cid2".to_string()));
    }

    #[test]
    fn test_extract_images_missing_image_field() {
        let row = make_row(Some(json!([
            {"notImage": {"ref": {"$link": "cid1"}}}
        ])));
        assert!(extract_images(&row).is_empty());
    }

    #[test]
    fn test_extract_images_missing_ref_field() {
        let row = make_row(Some(json!([
            {"image": {"mimeType": "image/jpeg"}}
        ])));
        assert!(extract_images(&row).is_empty());
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
