use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::UriValue;
use observing_lexicons::bio_lexicons::temp::v0_1::identification::{
    Identification, IdentificationRecord, IdentificationTaxonRank,
};
use serde_json::Value;

use crate::auth;
use crate::error::AppError;
use crate::state::AppState;

/// Build an identification record value for a given scientific name.
///
/// Validates taxonomy and constructs the AT Protocol identification record.
/// `user_taxon_rank` is used only when taxonomy validation cannot resolve a
/// rank — taxonomy is authoritative for known taxa. `user_kingdom` is
/// forwarded to GBIF as a disambiguator and used as a fallback when
/// validation doesn't return a kingdom (e.g. genus-level names without a
/// hint). `user_taxon_id` is the stable taxon URI from the user's GBIF
/// autocomplete pick; it takes priority over the URI validation resolves,
/// since the user's selection is the authoritative match.
/// Returns the record JSON value ready to be posted via the agent.
pub async fn build_identification_record(
    state: &AppState,
    scientific_name: &str,
    user_taxon_rank: Option<&str>,
    user_kingdom: Option<&str>,
    user_taxon_id: Option<&str>,
    occurrence_uri: &str,
    occurrence_cid: &str,
) -> Result<Value, AppError> {
    let mut taxon_rank = None;
    let mut kingdom = None;
    let mut taxon_id = user_taxon_id.map(str::to_owned);

    if let Some(validation) = state.taxonomy.validate(scientific_name, user_kingdom).await {
        if let Some(ref t) = validation.taxon {
            taxon_rank = Some(t.rank.clone());
            kingdom = t.kingdom.clone();
            if taxon_id.is_none() {
                taxon_id = t.taxon_id.clone();
            }
        }
    }

    if taxon_rank.is_none() {
        taxon_rank = user_taxon_rank.map(str::to_owned);
    }
    if kingdom.is_none() {
        kingdom = user_kingdom.map(str::to_owned);
    }

    let occurrence = auth::build_strong_ref(occurrence_uri, occurrence_cid)?;

    // `taxonID` has lexicon format `uri`; drop anything that doesn't parse as a
    // URI rather than letting an invalid value fail the whole record write.
    let taxon_id_uri = taxon_id
        .as_deref()
        .and_then(|s| UriValue::new_owned(s).ok());

    let record = Identification::new()
        .occurrence(occurrence)
        .scientific_name(scientific_name)
        .maybe_taxon_rank(
            taxon_rank
                .as_deref()
                .map(|s| IdentificationTaxonRank::from_value(s.into())),
        )
        .maybe_kingdom(kingdom.as_deref().map(Into::into))
        .maybe_taxon_id(taxon_id_uri)
        .build();

    let mut id_value = auth::serialize_at_record(&record)?;

    // App-specific fields (not in upstream lexicon, stored as extra data in the AT Protocol record)
    if let Some(obj) = id_value.as_object_mut() {
        obj.insert(
            "createdAt".to_string(),
            serde_json::json!(chrono::Utc::now().to_rfc3339()),
        );
    }

    Ok(id_value)
}

/// The NSID for identifications, re-exported for convenience.
pub fn identification_nsid() -> &'static str {
    IdentificationRecord::NSID
}
