//! Background task that carries out queued cross-posts.
//!
//! Runs in-process: woken when a cross-post is queued, and sweeping on a
//! timer for retries. Every step is safe to repeat (see [`super::ids`]), so a
//! job that fails partway is simply run again.

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use atproto_blob_resolver::Did;
use inaturalist::Upload;
use jacquard_common::types::string::AtUri;
use observing_db::types::CrosspostRow;
use tracing::{info, warn};

use super::client::InatError;
use super::links::{self, WriteBack};
use super::payload::{self, OccurrenceFields, TaxonChoice};
use super::{ids, Inat, SERVICE};
use crate::auth;
use crate::constants::MAX_EXTERNAL_RECORDS;
use crate::error::AppError;
use crate::routes::media::fetch_and_cache;
use crate::state::AppState;

/// Attempts before a cross-post is marked `failed` and left for its owner to
/// retry. The queue waits 30s, 90s, then 210s between them, so a failure that
/// keeps recurring is reported after about six minutes. A failure that
/// retrying can't fix is reported at once (see [`InatError::permanent`]).
const MAX_ATTEMPTS: i32 = 4;

/// How often to look for cross-posts whose backoff has elapsed.
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

pub fn spawn(state: AppState, inat: Arc<Inat>) {
    tokio::spawn(async move {
        loop {
            run_pending(&state, &inat).await;
            tokio::select! {
                _ = inat.woken() => {}
                _ = tokio::time::sleep(SWEEP_INTERVAL) => {}
            }
        }
    });
}

/// Work through every cross-post that is due.
///
/// Jobs are claimed one at a time: a claim is a 30s lease (the queue's first
/// backoff), and a job claimed in a batch could sit behind the others for
/// longer than that and be claimed again by another instance.
async fn run_pending(state: &AppState, inat: &Inat) {
    loop {
        let job = match observing_db::crossposts::claim_pending(&state.pool, SERVICE, 1).await {
            Ok(jobs) => jobs.into_iter().next(),
            Err(e) => {
                warn!(error = %e, "Failed to claim pending cross-posts");
                return;
            }
        };
        let Some(job) = job else {
            return;
        };

        let outcome = match crosspost(state, inat, &job).await {
            Ok(()) => {
                info!(uri = %job.occurrence_uri, "Cross-posted occurrence to iNaturalist");
                observing_db::crossposts::mark_synced(&state.pool, &job.occurrence_uri, SERVICE)
                    .await
            }
            Err(e) => {
                warn!(
                    uri = %job.occurrence_uri,
                    attempt = job.attempts,
                    permanent = e.permanent,
                    error = %e,
                    "Cross-post to iNaturalist failed"
                );
                observing_db::crossposts::record_failure(
                    &state.pool,
                    &job.occurrence_uri,
                    SERVICE,
                    &e.message,
                    // Zero attempts allowed: fail now instead of retrying.
                    if e.permanent { 0 } else { MAX_ATTEMPTS },
                )
                .await
            }
        };
        if let Err(e) = outcome {
            warn!(uri = %job.occurrence_uri, error = %e, "Failed to record cross-post outcome");
        }
    }
}

/// Post one occurrence: the observation, the link back to it on the PDS
/// record, then its photos.
async fn crosspost(state: &AppState, inat: &Inat, job: &CrosspostRow) -> Result<(), InatError> {
    let at_uri = AtUri::from_str(&job.occurrence_uri)
        .map_err(|_| InatError::permanent("The occurrence has an invalid AT URI"))?;
    let rkey = at_uri
        .rkey()
        .ok_or_else(|| InatError::permanent("The occurrence's AT URI has no record key"))?;
    let rkey = rkey.as_str();
    let did = Did::new_owned(&job.did)
        .map_err(|_| InatError::permanent("The occurrence has an invalid DID"))?;

    let account = observing_db::crossposts::get_account(&state.pool, &job.did, SERVICE)
        .await
        .map_err(database)?
        .ok_or_else(unlinked)?;
    let jwt = inat.api_token(&job.did, &account.access_token).await?;

    let occurrence = observing_db::occurrences::get(&state.pool, &job.occurrence_uri)
        .await
        .map_err(database)?
        .ok_or_else(gone)?;

    let observation_uuid = ids::observation_uuid(&job.did, rkey);
    // The observation is posted once. An attempt that picks up after it
    // exists, to finish the link or the photos, must not post it again: that
    // would overwrite whatever its owner has changed on iNaturalist since.
    let url = match &job.external_uri {
        Some(url) => url.clone(),
        None => {
            let taxon = choose_taxon(state, inat, &jwt, job).await?;
            let observation = payload::build_observation(
                observation_uuid,
                &OccurrenceFields {
                    event_date: occurrence.event_date.as_deref(),
                    latitude: occurrence.latitude,
                    longitude: occurrence.longitude,
                    coordinate_uncertainty_meters: occurrence.coordinate_uncertainty_meters,
                },
                taxon,
            );
            let id = inat.client.upsert_observation(&jwt, observation).await?;
            let url = links::observation_url(inat.site_url(), id);
            observing_db::crossposts::set_external_uri(
                &state.pool,
                &job.occurrence_uri,
                SERVICE,
                &url,
            )
            .await
            .map_err(database)?;
            url
        }
    };

    // Before the photos, so the public link is up even if an upload fails. A
    // failure here still lets the photos through; the job is retried for it.
    let written_back = write_link_back(state, job, &at_uri, &url).await;

    for (position, blob) in occurrence.blob_entries().iter().enumerate() {
        let cid = blob.image.ref_.cid();
        if job.synced_blob_cids.iter().any(|synced| synced == cid) {
            continue;
        }
        let (data, _, _) = fetch_and_cache(&state.media, &did, cid)
            .await
            .map_err(|e| {
                warn!(uri = %job.occurrence_uri, cid = %cid, error = %e, "Failed to fetch photo");
                InatError::transient(format!("Could not fetch photo {cid} from your PDS"))
            })?;
        let photo = Upload {
            file_name: payload::photo_file_name(cid, &blob.image.mime_type),
            content_type: Some(blob.image.mime_type.clone()),
            data,
        };
        inat.client
            .attach_photo(
                &jwt,
                observation_uuid,
                ids::photo_uuid(&job.did, rkey, cid),
                i32::try_from(position).unwrap_or(i32::MAX),
                photo,
            )
            .await?;
        observing_db::crossposts::add_synced_blob(&state.pool, &job.occurrence_uri, SERVICE, cid)
            .await
            .map_err(database)?;
    }

    written_back
}

/// The taxon to post, from the owner's own most recent identification.
async fn choose_taxon(
    state: &AppState,
    inat: &Inat,
    jwt: &str,
    job: &CrosspostRow,
) -> Result<TaxonChoice, InatError> {
    // Ordered newest first.
    let identifications =
        observing_db::identifications::get_for_occurrence(&state.pool, &job.occurrence_uri)
            .await
            .map_err(database)?;
    let Some(own) = identifications.into_iter().find(|id| id.did == job.did) else {
        return Ok(TaxonChoice::Unknown);
    };

    if let Some(id) = own.taxon_id.as_deref().and_then(payload::inat_taxon_id) {
        return Ok(TaxonChoice::Id(id));
    }
    let found = inat
        .client
        .find_taxon_id(jwt, &own.scientific_name, own.taxon_rank.as_deref())
        .await?;
    Ok(match found {
        Some(id) => TaxonChoice::Id(id),
        None => TaxonChoice::Guess(own.scientific_name),
    })
}

/// Add the iNaturalist observation to the occurrence record's
/// `externalRecords` on the PDS. The ingester picks the change up like any
/// other edit.
async fn write_link_back(
    state: &AppState,
    job: &CrosspostRow,
    at_uri: &AtUri,
    url: &str,
) -> Result<(), InatError> {
    let (agent, did) = auth::require_agent(&state.oauth_client, &job.did)
        .await
        .map_err(|e| pds("link the observation on the record", e))?;
    let (mut record, cid) = auth::get_at_record(&agent, did.clone(), at_uri)
        .await
        .map_err(|e| pds("link the observation on the record", e))?;

    match links::add_external_record(&mut record, url, MAX_EXTERNAL_RECORDS) {
        WriteBack::AlreadyPresent => {}
        WriteBack::Full => {
            warn!(
                uri = %job.occurrence_uri,
                "Occurrence has no room for an iNaturalist externalRecords entry; skipping"
            );
        }
        WriteBack::Added => {
            // Swapping on the fetched CID makes this fail, rather than
            // overwrite, if the owner edited the record in the meantime.
            auth::put_at_record(&agent, did, at_uri, record, cid)
                .await
                .map_err(|e| pds("link the observation on the record", e))?;
        }
    }
    Ok(())
}

// What these return is shown to the occurrence's owner, so the detail of an
// internal failure goes to the log instead.

fn unlinked() -> InatError {
    InatError::permanent("The iNaturalist account is no longer linked")
}

fn gone() -> InatError {
    InatError::permanent("The observation is no longer on observ.ing")
}

fn database(error: sqlx::Error) -> InatError {
    warn!(error = %error, "Database error while cross-posting");
    InatError::transient("Something went wrong on observ.ing")
}

fn pds(action: &str, error: AppError) -> InatError {
    match error {
        // Retrying can't restore a session; the owner has to.
        AppError::Unauthorized => InatError::permanent(
            "Your observ.ing session has expired: log in again, then retry posting",
        ),
        other => {
            warn!(error = ?other, "PDS error while cross-posting: could not {action}");
            InatError::transient(format!("Could not {action}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_database_error_keeps_its_detail_out_of_what_the_owner_sees() {
        let error = database(sqlx::Error::PoolTimedOut);
        assert_eq!(error.message, "Something went wrong on observ.ing");
        assert!(!error.permanent);
    }

    #[test]
    fn a_pds_error_keeps_its_detail_out_of_what_the_owner_sees() {
        let error = pds(
            "link the observation on the record",
            AppError::Internal("Failed to put record: secret detail".into()),
        );
        assert_eq!(
            error.message,
            "Could not link the observation on the record"
        );
        assert!(!error.permanent);
    }

    #[test]
    fn an_expired_session_tells_the_owner_what_to_do() {
        let error = pds("link the observation on the record", AppError::Unauthorized);
        assert!(error.message.contains("log in again"), "{error}");
        assert!(error.permanent);
    }

    #[test]
    fn errors_about_the_job_itself_are_permanent() {
        assert!(unlinked().permanent);
        assert!(gone().permanent);
    }
}
