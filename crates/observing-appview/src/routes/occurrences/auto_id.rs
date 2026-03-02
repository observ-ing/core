use std::str::FromStr;

use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri as JAtUri, Cid as JCid, Datetime};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use observing_lexicons::org_rwell::test::identification::{Identification, Taxon};
use serde_json::{json, Value};

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
    let mut vernacular_name = None;
    let mut kingdom = None;
    let mut phylum = None;
    let mut class = None;
    let mut order = None;
    let mut family = None;
    let mut genus = None;

    if let Some(validation) = state.taxonomy.validate(scientific_name).await {
        if let Some(ref t) = validation.taxon {
            taxon_id = Some(t.id.clone());
            taxon_rank = Some(t.rank.clone());
            vernacular_name = t.common_name.clone();
            kingdom = t.kingdom.clone();
            phylum = t.phylum.clone();
            class = t.class.clone();
            order = t.order.clone();
            family = t.family.clone();
            genus = t.genus.clone();
        }
    }

    let subject = StrongRef::new()
        .uri(JAtUri::from_str(occurrence_uri).expect("just-created URI must be valid"))
        .cid(JCid::from_str(occurrence_cid).expect("just-created CID must be valid"))
        .build();

    let taxon = Taxon {
        scientific_name: scientific_name.into(),
        taxon_rank: taxon_rank.as_deref().map(Into::into),
        vernacular_name: vernacular_name.as_deref().map(Into::into),
        kingdom: kingdom.as_deref().map(Into::into),
        phylum: phylum.as_deref().map(Into::into),
        class: class.as_deref().map(Into::into),
        order: order.as_deref().map(Into::into),
        family: family.as_deref().map(Into::into),
        genus: genus.as_deref().map(Into::into),
        ..Default::default()
    };

    let id_record = Identification::new()
        .taxon(taxon)
        .created_at(Datetime::now())
        .subject(subject)
        .maybe_taxon_id(taxon_id.as_deref().map(Into::into))
        .build();

    let mut id_value =
        serde_json::to_value(&id_record).map_err(|e| AppError::Internal(e.to_string()))?;
    id_value["$type"] = json!(Identification::NSID);

    Ok(id_value)
}

/// The NSID for identifications, re-exported for convenience.
pub fn identification_nsid() -> &'static str {
    Identification::NSID
}
