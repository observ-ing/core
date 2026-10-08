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
/// retry. With the queue's backoff that is about 15 minutes of trying.
const MAX_ATTEMPTS: i32 = 6;

/// How often to look for cross-posts whose backoff has elapsed.
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

const BATCH_SIZE: i64 = 5;

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
async fn run_pending(state: &AppState, inat: &Inat) {
    loop {
        let jobs =
            match observing_db::crossposts::claim_pending(&state.pool, SERVICE, BATCH_SIZE).await {
                Ok(jobs) => jobs,
                Err(e) => {
                    warn!(error = %e, "Failed to claim pending cross-posts");
                    return;
                }
            };
        if jobs.is_empty() {
            return;
        }
        for job in jobs {
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
                        error = %e,
                        "Cross-post to iNaturalist failed"
                    );
                    observing_db::crossposts::record_failure(
                        &state.pool,
                        &job.occurrence_uri,
                        SERVICE,
                        &e.0,
                        MAX_ATTEMPTS,
                    )
                    .await
                }
            };
            if let Err(e) = outcome {
                warn!(uri = %job.occurrence_uri, error = %e, "Failed to record cross-post outcome");
            }
        }
    }
}

/// Post one occurrence: the observation, the link back to it on the PDS
/// record, then its photos.
async fn crosspost(state: &AppState, inat: &Inat, job: &CrosspostRow) -> Result<(), InatError> {
    let at_uri = AtUri::from_str(&job.occurrence_uri)
        .map_err(|_| InatError("The occurrence has an invalid AT URI".into()))?;
    let rkey = at_uri
        .rkey()
        .ok_or_else(|| InatError("The occurrence's AT URI has no record key".into()))?;
    let rkey = rkey.as_str();

    let account = observing_db::crossposts::get_account(&state.pool, &job.did, SERVICE)
        .await
        .map_err(database)?
        .ok_or_else(|| InatError("The iNaturalist account is no longer linked".into()))?;
    let jwt = inat.api_token(&job.did, &account.access_token).await?;

    let occurrence = observing_db::occurrences::get(&state.pool, &job.occurrence_uri)
        .await
        .map_err(database)?
        .ok_or_else(|| InatError("The observation is no longer on observ.ing".into()))?;

    let taxon = choose_taxon(state, inat, &jwt, job).await?;
    let observation_uuid = ids::observation_uuid(&job.did, rkey);
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
    observing_db::crossposts::set_external_uri(&state.pool, &job.occurrence_uri, SERVICE, &url)
        .await
        .map_err(database)?;

    // Before the photos, so the public link is up even if an upload fails. A
    // failure here still lets the photos through; the job is retried for it.
    let written_back = write_link_back(state, job, &at_uri, &url).await;

    let did = Did::new_owned(&job.did)
        .map_err(|e| InatError(format!("The occurrence has an invalid DID: {e}")))?;
    for (position, blob) in occurrence.blob_entries().iter().enumerate() {
        let cid = blob.image.ref_.cid();
        if job.synced_blob_cids.iter().any(|synced| synced == cid) {
            continue;
        }
        let (data, _, _) = fetch_and_cache(&state.media, &did, cid)
            .await
            .map_err(|e| InatError(format!("Could not fetch photo {cid}: {e}")))?;
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
        .map_err(|e| pds("open a session to link the observation", e))?;
    let (mut record, cid) = auth::get_at_record(&agent, did.clone(), at_uri)
        .await
        .map_err(|e| pds("fetch the record to link the observation", e))?;

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

fn database(error: sqlx::Error) -> InatError {
    InatError(format!("Database error: {error}"))
}

fn pds(action: &str, error: AppError) -> InatError {
    InatError(format!("Could not {action}: {error:?}"))
}
