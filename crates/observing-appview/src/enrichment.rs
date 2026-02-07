use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use observing_db::types::{CommentRow, IdentificationRow, InteractionRow, OccurrenceRow};
use observing_identity::{IdentityResolver, Profile};
use serde::Serialize;
use sqlx::PgPool;

use crate::taxonomy_client::TaxonomyClient;

/// Enriched occurrence ready for API response
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceResponse {
    pub uri: String,
    pub cid: String,
    pub observer: ProfileSummary,
    pub observers: Vec<ObserverInfo>,
    pub scientific_name: Option<String>,
    pub community_id: Option<String>,
    pub effective_taxonomy: Option<EffectiveTaxonomy>,
    pub subjects: Vec<SubjectResponse>,
    pub event_date: String,
    pub location: LocationResponse,
    pub verbatim_locality: Option<String>,
    pub occurrence_remarks: Option<String>,
    pub taxon_id: Option<String>,
    pub taxon_rank: Option<String>,
    pub vernacular_name: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub images: Vec<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub like_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_has_liked: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub did: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverInfo {
    pub did: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationResponse {
    pub latitude: f64,
    pub longitude: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uncertainty_meters: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_province: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub county: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub municipality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectResponse {
    #[serde(rename = "index")]
    pub subject_index: i32,
    pub identification_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveTaxonomy {
    pub scientific_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vernacular_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kingdom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phylum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genus: Option<String>,
}

/// Enriched identification with profile info
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedIdentification {
    #[serde(flatten)]
    pub row: IdentificationRow,
    pub identifier: ProfileSummary,
}

/// Enriched comment with profile info
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedComment {
    #[serde(flatten)]
    pub row: CommentRow,
    pub commenter: ProfileSummary,
}

/// Enriched interaction with profile info
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
        if let Ok(observers) =
            observing_db::observers::get_for_occurrence(pool, &row.uri).await
        {
            observers_by_uri.insert(row.uri.clone(), observers);
        }
    }

    // Stage 3: Batch profile resolution
    let mut all_dids: HashSet<String> = rows.iter().map(|r| r.did.clone()).collect();
    for observers in observers_by_uri.values() {
        for o in observers {
            all_dids.insert(o.did.clone());
        }
    }
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
        let community_id =
            observing_db::identifications::get_community_id(pool, &row.uri, 0)
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
        let observer_rows = observers_by_uri
            .get(&row.uri)
            .cloned()
            .unwrap_or_default();
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
            scientific_name: row.scientific_name.clone(),
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
            taxon_id: row.taxon_id.clone(),
            taxon_rank: row.taxon_rank.clone(),
            vernacular_name: row.vernacular_name.clone(),
            kingdom: row.kingdom.clone(),
            phylum: row.phylum.clone(),
            class: row.class.clone(),
            order: row.order_.clone(),
            family: row.family.clone(),
            genus: row.genus.clone(),
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
    let identifications =
        observing_db::identifications::get_for_subject(pool, occurrence_uri, 0)
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
    if let Some(detail) = taxonomy.get_by_name(effective_name, occurrence_kingdom).await {
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
