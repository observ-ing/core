//! Whether an occurrence may be queued for cross-posting.
//!
//! These checks are a courtesy to the user, not the safety mechanism: if two
//! requests race past them, the derived UUID (see [`super::ids`]) still sends
//! both to the same iNaturalist observation.

use observing_db::types::ExternalRecordEntry;

use super::links::names_inat_observation;
use crate::error::AppError;

/// What is known about an occurrence someone asked to cross-post.
pub struct CrosspostRequest<'a> {
    pub user_did: &'a str,
    /// The DID in the occurrence's AT URI.
    pub occurrence_did: &'a str,
    /// Whether the user has linked an iNaturalist account.
    pub linked: bool,
    /// The occurrence's `externalRecords`, or `None` if it isn't indexed.
    pub external_records: Option<&'a [ExternalRecordEntry]>,
    /// Status of the occurrence's existing crosspost, if it has one.
    pub crosspost_status: Option<&'a str>,
}

#[derive(Debug, PartialEq)]
pub enum Refusal {
    NotOwner,
    NotLinked,
    NotFound,
    /// The occurrence already links to an iNaturalist observation.
    AlreadyOnInat,
    /// A cross-post is already pending or done. A failed one may be retried.
    AlreadyQueued,
}

pub fn check(request: &CrosspostRequest) -> Result<(), Refusal> {
    if request.occurrence_did != request.user_did {
        return Err(Refusal::NotOwner);
    }
    if !request.linked {
        return Err(Refusal::NotLinked);
    }
    let external_records = request.external_records.ok_or(Refusal::NotFound)?;
    if names_inat_observation(external_records) {
        return Err(Refusal::AlreadyOnInat);
    }
    match request.crosspost_status {
        None | Some("failed") => Ok(()),
        Some(_) => Err(Refusal::AlreadyQueued),
    }
}

impl From<Refusal> for AppError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::NotOwner => {
                AppError::Forbidden("You can only cross-post your own observations".into())
            }
            Refusal::NotLinked => AppError::Conflict("No iNaturalist account is linked".into()),
            Refusal::NotFound => AppError::NotFound("Occurrence not found".into()),
            Refusal::AlreadyOnInat => {
                AppError::Conflict("This observation already links to iNaturalist".into())
            }
            Refusal::AlreadyQueued => {
                AppError::Conflict("This observation has already been cross-posted".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_RECORDS: &[ExternalRecordEntry] = &[];

    fn request<'a>() -> CrosspostRequest<'a> {
        CrosspostRequest {
            user_did: "did:plc:owner",
            occurrence_did: "did:plc:owner",
            linked: true,
            external_records: Some(NO_RECORDS),
            crosspost_status: None,
        }
    }

    #[test]
    fn allows_an_owned_unposted_occurrence() {
        assert_eq!(check(&request()), Ok(()));
    }

    #[test]
    fn allows_retrying_a_failed_crosspost() {
        assert_eq!(
            check(&CrosspostRequest {
                crosspost_status: Some("failed"),
                ..request()
            }),
            Ok(())
        );
    }

    #[test]
    fn refuses_someone_elses_occurrence() {
        assert_eq!(
            check(&CrosspostRequest {
                occurrence_did: "did:plc:other",
                ..request()
            }),
            Err(Refusal::NotOwner)
        );
    }

    #[test]
    fn refuses_without_a_linked_account() {
        assert_eq!(
            check(&CrosspostRequest {
                linked: false,
                ..request()
            }),
            Err(Refusal::NotLinked)
        );
    }

    #[test]
    fn refuses_an_occurrence_that_is_not_indexed() {
        assert_eq!(
            check(&CrosspostRequest {
                external_records: None,
                ..request()
            }),
            Err(Refusal::NotFound)
        );
    }

    #[test]
    fn refuses_an_occurrence_that_already_links_to_inaturalist() {
        let records = [ExternalRecordEntry {
            uri: "https://inaturalist.nz/observations/1".into(),
            service: None,
        }];
        assert_eq!(
            check(&CrosspostRequest {
                external_records: Some(&records),
                ..request()
            }),
            Err(Refusal::AlreadyOnInat)
        );
    }

    #[test]
    fn refuses_a_pending_or_synced_crosspost() {
        for status in ["pending", "synced"] {
            assert_eq!(
                check(&CrosspostRequest {
                    crosspost_status: Some(status),
                    ..request()
                }),
                Err(Refusal::AlreadyQueued),
                "{status}"
            );
        }
    }

    #[test]
    fn ownership_is_checked_before_anything_is_revealed() {
        // Someone else's occurrence must not leak whether it exists or is posted.
        assert_eq!(
            check(&CrosspostRequest {
                occurrence_did: "did:plc:other",
                external_records: None,
                crosspost_status: Some("synced"),
                ..request()
            }),
            Err(Refusal::NotOwner)
        );
    }
}
