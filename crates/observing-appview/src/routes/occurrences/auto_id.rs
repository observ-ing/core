use jacquard_common::types::collection::Collection;
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
/// rank — taxonomy is authoritative for known taxa.
/// Returns the record JSON value ready to be posted via the agent.
pub async fn build_identification_record(
    state: &AppState,
    scientific_name: &str,
    user_taxon_rank: Option<&str>,
    occurrence_uri: &str,
    occurrence_cid: &str,
) -> Result<Value, AppError> {
    let mut taxon_rank = None;
    let mut kingdom = None;

    if let Some(validation) = state.taxonomy.validate(scientific_name).await {
        if let Some(ref t) = validation.taxon {
            taxon_rank = Some(t.rank.clone());
            kingdom = t.kingdom.clone();
        }
    }

    if taxon_rank.is_none() {
        taxon_rank = user_taxon_rank.map(str::to_owned);
    }

    let occurrence = auth::build_strong_ref(occurrence_uri, occurrence_cid)?;

    let record = Identification::new()
        .occurrence(occurrence)
        .scientific_name(scientific_name)
        .maybe_taxon_rank(
            taxon_rank
                .as_deref()
                .map(|s| IdentificationTaxonRank::from_value(s.into())),
        )
        .maybe_kingdom(kingdom.as_deref().map(Into::into))
        .build();

    let mut id_value = auth::serialize_at_record(&record)?;

    // App-specific fields (not in upstream lexicon, stored as extra data in the AT Protocol record)
    if let Some(obj) = id_value.as_object_mut() {
        obj.insert(
            "createdAt".to_string(),
            serde_json::json!(chrono::Utc::now().to_rfc3339()),
        );
        obj.insert("isAgreement".to_string(), serde_json::json!(false));
    }

    Ok(id_value)
}

/// The NSID for identifications, re-exported for convenience.
pub fn identification_nsid() -> &'static str {
    IdentificationRecord::NSID
}
