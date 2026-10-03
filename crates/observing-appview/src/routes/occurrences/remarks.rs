//! Writing the occurrence author's own Darwin Core remarks
//! (`bio.lexicons.temp.v0-1.remark`) alongside the occurrence that references
//! them.
//!
//! A remark only fills a term while the occurrence points at it
//! (`occurrenceRemarksID` / `eventRemarksID`), so every change is two PDS
//! writes with no transaction between them. The order keeps the gap harmless:
//! a remark is created or updated *before* the occurrence write that
//! references it, and deleted only *after* the occurrence write that drops the
//! reference. Either failure mode then leaves an unreferenced remark, which
//! fills nothing — never a reference to a record that doesn't exist.

use std::str::FromStr;

use jacquard_common::deps::smol_str::SmolStr;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::AtUri;
use observing_db::remarks::{EVENT_REMARKS, OCCURRENCE_REMARKS};
use observing_db::types::ResolvedRemarkRow;
use observing_lexicons::bio_lexicons::temp::v0_1::remark::{
    Remark, RemarkDwcTerm, RemarkLicense, RemarkRecord,
};
use tracing::{info, warn};

use crate::auth;
use crate::constants;
use crate::error::AppError;
use crate::state::AgentType;
use crate::validation::validate_string_length;

/// A Darwin Core remarks term the occurrence form edits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RemarkTerm {
    /// dwc:occurrenceRemarks — notes about the organism.
    Occurrence,
    /// dwc:eventRemarks — notes about the time and place.
    Event,
}

impl RemarkTerm {
    pub(super) const ALL: [RemarkTerm; 2] = [RemarkTerm::Occurrence, RemarkTerm::Event];

    /// The remark's `dwcTerm` value.
    pub(super) fn dwc_term(self) -> &'static str {
        match self {
            RemarkTerm::Occurrence => OCCURRENCE_REMARKS,
            RemarkTerm::Event => EVENT_REMARKS,
        }
    }

    /// The occurrence field holding the forward reference.
    pub(super) fn occurrence_field(self) -> &'static str {
        match self {
            RemarkTerm::Occurrence => "occurrenceRemarksID",
            RemarkTerm::Event => "eventRemarksID",
        }
    }

    fn label(self) -> &'static str {
        match self {
            RemarkTerm::Occurrence => "Occurrence remarks",
            RemarkTerm::Event => "Event remarks",
        }
    }

    fn lexicon_term(self) -> RemarkDwcTerm {
        match self {
            RemarkTerm::Occurrence => RemarkDwcTerm::OccurrenceRemarks,
            RemarkTerm::Event => RemarkDwcTerm::EventRemarks,
        }
    }
}

/// The result of [`prepare`]: what the occurrence write should reference, and
/// what to clean up once it has.
#[derive(Debug, Default)]
pub(super) struct PreparedRemark {
    /// AT-URI to write into the occurrence's `*RemarksID` field, if any.
    pub id: Option<String>,
    /// The user's previous remark for this term, to delete after the
    /// occurrence write has stopped referencing it.
    pub delete_after: Option<String>,
}

/// Normalize submitted remark text: blank means "no remark". Validates the
/// length against the lexicon so the PDS won't reject the record.
pub(super) fn normalize_text(
    term: RemarkTerm,
    text: Option<&str>,
) -> Result<Option<&str>, AppError> {
    let Some(text) = text.map(str::trim).filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    validate_string_length(text, 1, constants::MAX_REMARK_LENGTH, term.label())?;
    Ok(Some(text))
}

/// Bring the user's remark for `term` in line with `text` before the
/// occurrence write, returning the reference that write should carry.
///
/// - `existing_id` is the occurrence's current forward reference, read from
///   the PDS record (authoritative). Only a remark in the user's own repo is
///   ever rewritten or deleted; a reference to anything else is dropped from
///   the occurrence when the text changes, but the record itself is left alone.
/// - `indexed` is the remark as the appview last resolved it, used to skip a
///   `putRecord` when nothing changed and to keep the license it was
///   published under.
/// - `license` applies to a newly created remark: the observation's license.
#[allow(clippy::too_many_arguments)]
pub(super) async fn prepare(
    agent: &AgentType,
    user_did: &str,
    occurrence_uri: &str,
    term: RemarkTerm,
    text: Option<&str>,
    existing_id: Option<&str>,
    indexed: Option<&ResolvedRemarkRow>,
    license: Option<&str>,
) -> Result<PreparedRemark, AppError> {
    let own_existing = existing_id.filter(|id| is_own_remark(id, user_did));

    let Some(text) = text else {
        return Ok(PreparedRemark {
            id: None,
            delete_after: own_existing.map(str::to_string),
        });
    };

    let Some(existing) = own_existing else {
        let uri = create(agent, user_did, occurrence_uri, term, text, license).await?;
        return Ok(PreparedRemark {
            id: Some(uri),
            delete_after: None,
        });
    };

    let indexed = indexed.filter(|r| r.uri == existing);
    if indexed.is_some_and(|r| r.body == text) {
        return Ok(PreparedRemark {
            id: Some(existing.to_string()),
            delete_after: None,
        });
    }

    // Keep the license the remark was published under; fall back to the
    // observation's only when we can't see the old one.
    let license = match indexed {
        Some(r) => r.license.as_deref(),
        None => license,
    };
    let record = build_record(occurrence_uri, term, text, license)?;
    let at_uri = parse_at_uri(existing)?;
    auth::put_at_record(agent, did(user_did)?, &at_uri, record).await?;
    info!(uri = %existing, term = term.dwc_term(), "Updated remark (PDS)");
    Ok(PreparedRemark {
        id: Some(existing.to_string()),
        delete_after: None,
    })
}

/// Delete remarks the occurrence no longer references. Best-effort: a remark
/// left behind fills no term, so a failure here is logged, not surfaced.
pub(super) async fn delete_unreferenced(agent: &AgentType, user_did: &str, uris: &[String]) {
    for uri in uris {
        let result = match (parse_at_uri(uri), did(user_did)) {
            (Ok(at_uri), Ok(did)) => auth::delete_at_record(agent, did, &at_uri).await,
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        match result {
            Ok(()) => info!(%uri, "Deleted remark (PDS)"),
            Err(e) => warn!(%uri, error = ?e, "Failed to delete unreferenced remark"),
        }
    }
}

async fn create(
    agent: &AgentType,
    user_did: &str,
    occurrence_uri: &str,
    term: RemarkTerm,
    text: &str,
    license: Option<&str>,
) -> Result<String, AppError> {
    let record = build_record(occurrence_uri, term, text, license)?;
    let resp = auth::create_at_record(agent, did(user_did)?, RemarkRecord::NSID, record).await?;
    info!(uri = %resp.uri, term = term.dwc_term(), "Created remark (PDS)");
    Ok(resp.uri.to_string())
}

fn build_record(
    occurrence_uri: &str,
    term: RemarkTerm,
    text: &str,
    license: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    let record = Remark::new()
        .subject(parse_at_uri(occurrence_uri)?)
        .dwc_term(term.lexicon_term())
        .body(SmolStr::from(text))
        .maybe_license(license.map(|l| RemarkLicense::from_value(SmolStr::from(l))))
        .build();
    auth::serialize_at_record(&record)
}

/// Whether `uri` names a remark record in `user_did`'s own repo — the only
/// kind this app will overwrite or delete on the user's behalf.
pub(super) fn is_own_remark(uri: &str, user_did: &str) -> bool {
    AtUri::from_str(uri).is_ok_and(|u| {
        u.authority().as_str() == user_did
            && u.collection()
                .is_some_and(|c| c.as_str() == RemarkRecord::NSID)
            && u.rkey().is_some()
    })
}

fn parse_at_uri(uri: &str) -> Result<AtUri, AppError> {
    AtUri::from_str(uri).map_err(|_| AppError::Internal(format!("Invalid AT URI: {uri}")))
}

fn did(user_did: &str) -> Result<atrium_api::types::string::Did, AppError> {
    atrium_api::types::string::Did::new(user_did.to_string())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALICE: &str = "did:plc:alice";

    #[test]
    fn own_remark_requires_same_repo_and_collection() {
        assert!(is_own_remark(
            "at://did:plc:alice/bio.lexicons.temp.v0-1.remark/3kabc",
            ALICE
        ));
        assert!(!is_own_remark(
            "at://did:plc:mallory/bio.lexicons.temp.v0-1.remark/3kabc",
            ALICE
        ));
        assert!(!is_own_remark(
            "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/3kabc",
            ALICE
        ));
        assert!(!is_own_remark("not a uri", ALICE));
    }

    #[test]
    fn blank_text_means_no_remark() {
        assert_eq!(normalize_text(RemarkTerm::Occurrence, None).unwrap(), None);
        assert_eq!(
            normalize_text(RemarkTerm::Occurrence, Some("  \n ")).unwrap(),
            None
        );
        assert_eq!(
            normalize_text(RemarkTerm::Event, Some("  on the north slope ")).unwrap(),
            Some("on the north slope")
        );
    }

    #[test]
    fn over_long_text_is_rejected() {
        let text = "a".repeat(constants::MAX_REMARK_LENGTH + 1);
        assert!(matches!(
            normalize_text(RemarkTerm::Occurrence, Some(&text)),
            Err(AppError::BadRequest(_))
        ));
    }

    /// The written record is a valid lexicon remark naming its subject and
    /// term, so consumers can detect a reference pointing at the wrong remark.
    #[test]
    fn built_record_names_subject_and_term() {
        let record = build_record(
            "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/3kocc",
            RemarkTerm::Event,
            "Overcast, light drizzle.",
            Some("https://creativecommons.org/licenses/by/4.0/"),
        )
        .unwrap();

        assert_eq!(record["$type"], "bio.lexicons.temp.v0-1.remark");
        assert_eq!(
            record["subject"],
            "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/3kocc"
        );
        assert_eq!(record["dwcTerm"], "eventRemarks");
        assert_eq!(record["body"], "Overcast, light drizzle.");
        assert_eq!(
            record["license"],
            "https://creativecommons.org/licenses/by/4.0/"
        );
    }
}
