use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_lexicons::ing_observ::temp::identification::{
    Identification, IdentificationRecord, Taxon, TaxonTaxonRank,
};
use serde_json::Value;

use crate::auth;
use crate::error::AppError;
use crate::state::AppState;

/// Build an identification record value for a given scientific name.
///
/// Validates taxonomy and constructs the AT Protocol identification record.
/// Returns a tuple of (record JSON value, NSID) ready to be posted via the agent.
pub async fn build_identification_record(
    state: &AppState,
    scientific_name: &str,
    occurrence_uri: &str,
    occurrence_cid: &str,
) -> Result<Value, AppError> {
    let mut taxon_id = None;
    let mut taxon_rank = None;
    let mut kingdom = None;

    if let Some(validation) = state.taxonomy.validate(scientific_name).await {
        if let Some(ref t) = validation.taxon {
            taxon_id = Some(t.id.clone());
            taxon_rank = Some(t.rank.clone());
            kingdom = t.kingdom.clone();
        }
    }

    let subject = auth::build_strong_ref(occurrence_uri, occurrence_cid)?;

    let taxon = Taxon {
        scientific_name: scientific_name.into(),
        taxon_rank: taxon_rank
            .as_deref()
            .map(|s| TaxonTaxonRank::from_value(s.into())),
        kingdom: kingdom.as_deref().map(Into::into),
        ..Default::default()
    };

    let id_record = Identification::new()
        .taxon(taxon)
        .created_at(Datetime::now())
        .subject(subject)
        .maybe_taxon_id(taxon_id.as_deref().map(Into::into))
        .build();

    let id_value = auth::serialize_at_record(&id_record)?;

    Ok(id_value)
}

/// The NSID for identifications, re-exported for convenience.
pub fn identification_nsid() -> &'static str {
    IdentificationRecord::NSID
}
