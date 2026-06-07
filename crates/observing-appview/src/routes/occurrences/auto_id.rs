use jacquard_common::deps::smol_str::SmolStr;
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

    assemble_identification_record(
        scientific_name,
        taxon_rank.as_deref(),
        kingdom.as_deref(),
        taxon_id.as_deref(),
        occurrence_uri,
        occurrence_cid,
    )
}

/// Assemble the AT Protocol identification record JSON from already-resolved
/// fields. Split out from [`build_identification_record`] so the record shape
/// (including `taxonID` coercion and the app-specific `createdAt` stamp) can be
/// unit-tested without a live taxonomy lookup.
fn assemble_identification_record(
    scientific_name: &str,
    taxon_rank: Option<&str>,
    kingdom: Option<&str>,
    taxon_id: Option<&str>,
    occurrence_uri: &str,
    occurrence_cid: &str,
) -> Result<Value, AppError> {
    let occurrence = auth::build_strong_ref(occurrence_uri, occurrence_cid)?;

    let record = Identification::new()
        .occurrence(occurrence)
        .scientific_name(scientific_name)
        .maybe_taxon_rank(taxon_rank.map(|s| IdentificationTaxonRank::from_value(s.into())))
        .maybe_kingdom(kingdom.map(Into::into))
        .build();

    let mut id_value = auth::serialize_at_record(&record)?;

    if let Some(obj) = id_value.as_object_mut() {
        // `taxonID` uses Darwin Core's canonical uppercase-`ID` casing, which is
        // what the ingester (`observing-db::processing`) reads. The generated
        // lexicon struct's `taxon_id` field serializes as camelCase `taxonId`
        // (no field-level rename under `rename_all = "camelCase"`), which the
        // ingester deliberately ignores — so write the key by hand like
        // `createdAt`. Require a real URI scheme (lexicon format `uri`); a bare
        // string parses as `UriValue::Any`, which we drop rather than letting a
        // bad value through into the record.
        let taxon_id_uri = taxon_id
            .and_then(|s| UriValue::<SmolStr>::new_owned(s).ok())
            .filter(|uri| !matches!(uri, UriValue::Any(_)));
        if let Some(uri) = taxon_id_uri {
            obj.insert("taxonID".to_string(), serde_json::json!(uri.as_str()));
        }
        // App-specific field (not in the upstream lexicon), stored as extra data
        // in the AT Protocol record.
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

#[cfg(test)]
mod tests {
    use super::*;

    const OCCURRENCE_URI: &str = "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc";
    const OCCURRENCE_CID: &str = "bafyreioccurrence";

    /// A GBIF autocomplete pick threads its species URI straight onto the
    /// record's Darwin Core `taxonID` field (canonical uppercase-`ID` casing
    /// the ingester reads back in `observing-db::processing`).
    #[test]
    fn writes_gbif_taxon_id_to_record() {
        let value = assemble_identification_record(
            "Passer domesticus",
            Some("species"),
            Some("Animalia"),
            Some("https://www.gbif.org/species/5231190"),
            OCCURRENCE_URI,
            OCCURRENCE_CID,
        )
        .expect("record assembles");

        assert_eq!(value["scientificName"], "Passer domesticus");
        assert_eq!(value["taxonID"], "https://www.gbif.org/species/5231190");
    }

    /// No taxon URI (e.g. a free-text name with no autocomplete pick) leaves
    /// `taxonID` off the record entirely rather than emitting a null/empty.
    #[test]
    fn omits_taxon_id_when_absent() {
        let value = assemble_identification_record(
            "Passer domesticus",
            Some("species"),
            None,
            None,
            OCCURRENCE_URI,
            OCCURRENCE_CID,
        )
        .expect("record assembles");

        assert!(
            value.get("taxonID").is_none(),
            "taxonID must be absent, got {:?}",
            value.get("taxonID")
        );
    }

    /// A value that isn't a parseable URI is dropped rather than failing the
    /// whole write — the record is still published, just without `taxonID`.
    #[test]
    fn drops_non_uri_taxon_id() {
        let value = assemble_identification_record(
            "Passer domesticus",
            Some("species"),
            None,
            Some("not a uri"),
            OCCURRENCE_URI,
            OCCURRENCE_CID,
        )
        .expect("record still assembles");

        assert!(
            value.get("taxonID").is_none(),
            "a non-URI taxonID must be dropped, got {:?}",
            value.get("taxonID")
        );
    }
}
