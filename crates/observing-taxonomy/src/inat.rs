//! iNaturalist taxa client — secondary source for search and validation.
//!
//! GBIF's backbone taxonomy omits informal clades like Angiospermae (flowering
//! plants), so searches for common group names return unrelated fuzzy matches.
//! iNaturalist's taxonomy includes these groups, so we use it as a fallback to
//! fill gaps in what GBIF can find.

use crate::types::TaxonResult;
use inaturalist::apis::{
    configuration::Configuration,
    taxa_api::{taxa_autocomplete_get, TaxaAutocompleteGetParams},
};
use inaturalist::models::AutocompleteTaxon;
use tracing::warn;

/// iNaturalist API client.
pub struct InatClient {
    config: Configuration,
}

impl InatClient {
    pub fn new() -> Self {
        let mut config = Configuration::new();
        // The crate's default base_path is "/v1" (relative) — point it at the real host.
        config.base_path = "https://api.inaturalist.org/v1".to_string();
        config.user_agent = Some("observ.ing-taxonomy/0.1".to_string());
        // The crate's default reqwest Client has HTTPS thanks to feature unification
        // via the `reqwest_0_12_tls_enabler` alias in our Cargo.toml.
        Self { config }
    }

    /// Autocomplete-style search. Returns `TaxonResult`s converted from iNat
    /// taxa, filtered to active taxa only. Errors are logged and swallowed —
    /// iNat is a supplementary source and its unavailability must not break
    /// the primary GBIF search.
    pub async fn search(&self, query: &str, limit: u32) -> Vec<TaxonResult> {
        let params = TaxaAutocompleteGetParams {
            q: query.to_string(),
            is_active: Some(true),
            taxon_id: None,
            rank: None,
            rank_level: None,
            per_page: Some(limit.to_string()),
            locale: None,
            preferred_place_id: None,
            all_names: None,
        };

        let response = match taxa_autocomplete_get(&self.config, params).await {
            Ok(r) => r,
            Err(e) => {
                warn!(query = %query, error = ?e, "iNat autocomplete failed");
                return Vec::new();
            }
        };

        response
            .results
            .iter()
            .filter_map(autocomplete_to_taxon)
            .collect()
    }

    /// Look up an exact scientific name via iNat autocomplete. Used as a
    /// fallback from `validate()` when GBIF has no match.
    pub async fn find_exact(&self, name: &str) -> Option<TaxonResult> {
        let results = self.search(name, 10).await;
        results
            .into_iter()
            .find(|t| t.scientific_name.eq_ignore_ascii_case(name))
    }
}

/// Convert an iNat `AutocompleteTaxon` into our internal `TaxonResult`.
///
/// Drops entries without an id or name (both required for a useful result).
/// Populates `kingdom` from iNat's `iconic_taxon_name` when it's one of the
/// Linnaean kingdoms — iNat's iconic taxa are a small curated set of high-level
/// groups (Animalia, Plantae, Fungi, Protozoa, Chromista, Bacteria, as well as
/// some class-level shortcuts like Aves that we ignore here).
fn autocomplete_to_taxon(item: &AutocompleteTaxon) -> Option<TaxonResult> {
    let id = item.id?;
    let name = item.name.as_deref().filter(|s| !s.is_empty())?;

    let rank = item
        .rank
        .as_deref()
        .map(|r| r.to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());

    let photo_url = item
        .default_photo
        .as_ref()
        .and_then(|p| p.medium_url.clone().or_else(|| p.square_url.clone()));

    Some(TaxonResult {
        id: format!("inat:{}", id),
        scientific_name: name.to_string(),
        common_name: item.preferred_common_name.clone(),
        photo_url,
        rank,
        kingdom: item
            .iconic_taxon_name
            .as_deref()
            .and_then(iconic_to_kingdom),
        phylum: None,
        class: None,
        order: None,
        family: None,
        genus: None,
        species: None,
        source: "inat".to_string(),
        conservation_status: None,
        is_synonym: false,
        accepted_name: None,
    })
}

/// Map iNat's `iconic_taxon_name` to a Linnaean kingdom when it is one.
/// iNat also uses lower-rank iconic groups (Aves, Reptilia, Mollusca, …)
/// which don't have a clean kingdom mapping here — return None for those.
fn iconic_to_kingdom(iconic: &str) -> Option<String> {
    match iconic {
        "Animalia" | "Plantae" | "Fungi" | "Protozoa" | "Chromista" | "Bacteria" | "Archaea" => {
            Some(iconic.to_string())
        }
        // Class- or phylum-level iconic taxa — all under Animalia in iNat.
        "Aves" | "Amphibia" | "Reptilia" | "Mammalia" | "Actinopterygii" | "Mollusca"
        | "Arachnida" | "Insecta" => Some("Animalia".to_string()),
        _ => None,
    }
}
