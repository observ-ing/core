//! Discovery surfaces driven by the species range index.
//!
//! `GET /api/discover/here` answers "what could you find near here" from
//! global range data alone — no platform activity required, which is what
//! makes it useful before the network has density. `GET /api/discover/to-find`
//! personalizes it by subtracting the viewer's life list, turning it into a
//! single-player "to find" checklist.
//!
//! Ranking note (v1): the range index is presence-only — it tells us *which*
//! species occur at a point, with no abundance or range-size signal to rank
//! by. So instead of a fake commonness order we surface a **deterministic
//! daily sample, diversified across taxonomic groups** — "today's N to find
//! near here". Stable for a given (day, ~location, viewer); rotates daily. A
//! true difficulty order waits on a `range_size` addition to the index.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{Hash, Hasher};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::auth::AuthUser;
use crate::species_id_client::SpeciesRef;
use crate::state::AppState;
use crate::taxonomy_client::ConservationStatus;

const DEFAULT_LIMIT: usize = 12;
const MAX_LIMIT: usize = 48;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverQuery {
    lat: f64,
    lon: f64,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

/// One enriched "to find" card: a range-set species hydrated with its photo,
/// common name, and conservation status for display.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToFindSpecies {
    scientific_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    common_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kingdom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    photo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conservation_status: Option<ConservationStatus>,
    /// GBIF id for the `/taxon/...` link target, when the name resolves.
    #[serde(skip_serializing_if = "Option::is_none")]
    taxon_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResponse {
    /// False when the range index has no opinion at this point (open ocean /
    /// poles, or no geo index loaded). `items` is then empty — distinct from
    /// "we checked and nothing lives here".
    area_has_data: bool,
    /// Species in range at this point, before sampling or life-list
    /// subtraction. Lets the UI say "12 of 240 to find near you".
    total_in_range: usize,
    /// Remaining after subtracting the viewer's life list (equals
    /// `total_in_range` for the logged-out `/here` view).
    remaining: usize,
    /// Today's diversified sample, enriched for display.
    items: Vec<ToFindSpecies>,
}

/// `GET /api/discover/here?lat=..&lon=..[&limit=]`
///
/// "What lives near here" — no auth, no personalization. The cold-start-proof
/// discovery hero: rich from global range data with zero platform activity.
pub async fn here(State(state): State<AppState>, Query(q): Query<DiscoverQuery>) -> Response {
    discover(&state, q, &HashSet::new(), None).await
}

/// `GET /api/discover/to-find?lat=..&lon=..[&limit=]`
///
/// Personalized: the in-range set minus the viewer's life list — what they
/// could find near here but haven't documented yet.
pub async fn to_find(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<DiscoverQuery>,
) -> Response {
    let life = match observing_db::discover::life_list(&state.pool, &user.did).await {
        Ok(rows) => rows
            .into_iter()
            .map(|(name, kingdom)| match_key(&name, kingdom.as_deref()))
            .collect::<HashSet<_>>(),
        Err(e) => {
            error!(error = %e, "life_list query failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to load your observations".into(),
                }),
            )
                .into_response();
        }
    };
    discover(&state, q, &life, Some(&user.did)).await
}

/// Shared core: fetch the in-range set, subtract `exclude`, take today's
/// diversified sample, and enrich it. `did` (when present) seeds the daily
/// sample per-user so two people in the same place get different lists.
async fn discover(
    state: &AppState,
    q: DiscoverQuery,
    exclude: &HashSet<String>,
    did: Option<&str>,
) -> Response {
    let Some(client) = &state.species_id else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "Species range data not available".into(),
            }),
        )
            .into_response();
    };

    let in_range = match client.species_in_range(q.lat, q.lon).await {
        Ok(r) => r,
        Err(e) => {
            error!(error = %e, "species-in-range upstream failed");
            return (
                StatusCode::BAD_GATEWAY,
                Json(ErrorResponse {
                    error: "Species range lookup failed".into(),
                }),
            )
                .into_response();
        }
    };

    if !in_range.area_has_data {
        return Json(DiscoverResponse {
            area_has_data: false,
            total_in_range: 0,
            remaining: 0,
            items: Vec::new(),
        })
        .into_response();
    }

    let total_in_range = in_range.species.len();
    let remaining_species: Vec<SpeciesRef> = in_range
        .species
        .into_iter()
        .filter(|s| !exclude.contains(&match_key(&s.scientific_name, s.kingdom.as_deref())))
        .collect();
    let remaining = remaining_species.len();

    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    // The index is presence-only, so a uniform sample skews to the obscure
    // long tail — and most of those lack a Wikidata photo, which reads as
    // broken in a grid. Oversample, enrich, then float photographed species up
    // (stable, so the daily diversification is preserved within each group)
    // and trim to `limit`. A cheap stand-in for a real charisma/abundance
    // signal until the index can expose range size.
    let oversample = (limit * 3).min(60);
    let sample = sample_diversified(remaining_species, daily_seed(q.lat, q.lon, did), oversample);
    let mut items = enrich(state, sample).await;
    items.sort_by_key(|it| it.photo_url.is_none());
    items.truncate(limit);

    Json(DiscoverResponse {
        area_has_data: true,
        total_in_range,
        remaining,
        items,
    })
    .into_response()
}

/// Hydrate each sampled species with its GBIF/Wikidata detail (photo, common
/// name, conservation status, id). Runs the lookups concurrently; failures
/// degrade to the name-only card.
async fn enrich(state: &AppState, species: Vec<SpeciesRef>) -> Vec<ToFindSpecies> {
    let futures = species.into_iter().map(|s| {
        let taxonomy = state.taxonomy.clone();
        async move {
            let detail = taxonomy
                .get_by_name(&s.scientific_name, s.kingdom.as_deref())
                .await
                .ok()
                .flatten();
            match detail {
                Some(d) => ToFindSpecies {
                    scientific_name: s.scientific_name,
                    common_name: d.common_name.or(s.common_name),
                    kingdom: s.kingdom,
                    photo_url: d.photo_url,
                    conservation_status: d.conservation_status,
                    taxon_id: Some(d.id),
                },
                None => ToFindSpecies {
                    scientific_name: s.scientific_name,
                    common_name: s.common_name,
                    kingdom: s.kingdom,
                    photo_url: None,
                    conservation_status: None,
                    taxon_id: None,
                },
            }
        }
    });
    futures::future::join_all(futures).await
}

/// Normalized subtraction key, applied identically to the life list and the
/// range set so name-formatting differences don't leak found species back
/// into the "to find" list.
fn match_key(scientific_name: &str, kingdom: Option<&str>) -> String {
    format!(
        "{}|{}",
        scientific_name.trim().to_lowercase(),
        kingdom.unwrap_or("").trim().to_lowercase()
    )
}

/// Seed for the daily sample: stable for a (UTC day, ~11 km location bucket,
/// viewer) tuple so the list is consistent within a day and rotates the next.
fn daily_seed(lat: f64, lon: f64, did: Option<&str>) -> u64 {
    let mut h = DefaultHasher::new();
    chrono::Utc::now().date_naive().to_string().hash(&mut h);
    ((lat * 10.0).round() as i64).hash(&mut h);
    ((lon * 10.0).round() as i64).hash(&mut h);
    if let Some(d) = did {
        d.hash(&mut h);
    }
    h.finish()
}

/// Deterministically shuffle by `hash(seed, name)`, then round-robin across
/// taxonomic groups so the sample is varied (no single kingdom dominates)
/// rather than alphabetical or clumped.
fn sample_diversified(species: Vec<SpeciesRef>, seed: u64, limit: usize) -> Vec<SpeciesRef> {
    let mut shuffled = species;
    shuffled.sort_by_key(|s| {
        let mut h = DefaultHasher::new();
        seed.hash(&mut h);
        s.scientific_name.hash(&mut h);
        h.finish()
    });

    // Bucket by kingdom, preserving the shuffled order within each bucket.
    let mut buckets: Vec<VecDeque<SpeciesRef>> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for s in shuffled {
        let key = s.kingdom.clone().unwrap_or_default();
        let i = *index.entry(key).or_insert_with(|| {
            buckets.push(VecDeque::new());
            buckets.len() - 1
        });
        buckets[i].push_back(s);
    }

    let mut out = Vec::with_capacity(limit.min(buckets.iter().map(|b| b.len()).sum()));
    while out.len() < limit {
        let before = out.len();
        for bucket in buckets.iter_mut() {
            if out.len() >= limit {
                break;
            }
            if let Some(s) = bucket.pop_front() {
                out.push(s);
            }
        }
        if out.len() == before {
            break; // every bucket drained
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sp(name: &str, kingdom: &str) -> SpeciesRef {
        SpeciesRef {
            scientific_name: name.to_string(),
            common_name: None,
            kingdom: Some(kingdom.to_string()),
        }
    }

    #[test]
    fn match_key_normalizes_case_and_whitespace() {
        assert_eq!(
            match_key("  Sialia Sialis ", Some("Animalia")),
            match_key("sialia sialis", Some("animalia"))
        );
    }

    #[test]
    fn sample_is_deterministic_for_a_seed() {
        let pool = vec![sp("a", "Animalia"), sp("b", "Plantae"), sp("c", "Fungi")];
        let a = sample_diversified(pool.clone(), 42, 3);
        let b = sample_diversified(pool, 42, 3);
        let names = |v: &[SpeciesRef]| {
            v.iter()
                .map(|s| s.scientific_name.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&a), names(&b));
    }

    #[test]
    fn sample_diversifies_across_kingdoms_before_repeating_one() {
        // 4 plants + 1 animal, limit 2 → round-robin yields one of each.
        let pool = vec![
            sp("p1", "Plantae"),
            sp("p2", "Plantae"),
            sp("p3", "Plantae"),
            sp("p4", "Plantae"),
            sp("a1", "Animalia"),
        ];
        let out = sample_diversified(pool, 7, 2);
        let kingdoms: HashSet<_> = out.iter().filter_map(|s| s.kingdom.clone()).collect();
        assert_eq!(out.len(), 2);
        assert_eq!(kingdoms.len(), 2, "should pull from both kingdoms first");
    }

    #[test]
    fn sample_caps_at_available_when_fewer_than_limit() {
        let out = sample_diversified(vec![sp("only", "Animalia")], 1, 12);
        assert_eq!(out.len(), 1);
    }
}
