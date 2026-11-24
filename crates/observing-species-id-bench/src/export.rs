//! `export`: draw a fixed, seeded sample of observations whose community ID
//! has reached agreement, and freeze their photos and ground truth on disk.
//!
//! Two sources give the same dataset shape:
//!
//! * `--database-url`: the appview's Postgres. Candidates come from
//!   `ingester.community_ids` joined to the `ingester.taxa` cache on the
//!   accepted taxon key; photos come from each author's PDS.
//! * `--api`: an appview's public HTTP API (e.g. `https://observ.ing`), for
//!   when you have no database access. Candidates come from the explore feed
//!   filtered to observations with a consensus ID and media; photos come
//!   through the appview's media proxy.
//!
//! Either way, the agreement rule is the appview's own
//! [`observing_db::community_ids::calculate`]: each user's latest ID counts
//! once, and at least two thirds of identifiers must agree. `--min-identifiers`
//! (default 2, iNaturalist's "research grade") sets how many identifiers that
//! takes; 1 also admits observations only their observer has identified.

use crate::dataset::{self, Annotation, Manifest, Sample, Taxon};
use crate::names;
use anyhow::{bail, Context, Result};
use atproto_blob_resolver::{BlobResolver, Did};
use futures::StreamExt;
use observing_db::community_ids;
use observing_db::types::{BlobEntry, IdentificationRow};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use sqlx::{Executor, PgPool, Row};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::Mutex;

/// The two-thirds rule from `observing_db::community_ids` (its constant is private).
const AGREEMENT_THRESHOLD: f64 = 2.0 / 3.0;

pub enum Source {
    Db {
        url: String,
        /// Fetch photos through this appview's `/media/blob` proxy instead of
        /// straight from each author's PDS.
        media_base: Option<String>,
    },
    Api {
        base: String,
    },
}

pub struct ExportOptions {
    pub out: PathBuf,
    pub size: usize,
    pub seed: u64,
    pub min_identifiers: usize,
    pub concurrency: usize,
    pub force: bool,
}

struct Candidate {
    occurrence_uri: String,
    did: String,
    image_cid: String,
    license: Option<String>,
    community_name: String,
    taxon: Taxon,
    latitude: Option<f64>,
    longitude: Option<f64>,
    organism_quantity: Option<String>,
    /// Preloaded by the DB source; fetched one by one from the API.
    identifications: Option<Vec<IdentificationRow>>,
}

type Skipped = BTreeMap<String, usize>;

fn skip(skipped: &mut Skipped, reason: &str) {
    *skipped.entry(reason.to_string()).or_default() += 1;
}

pub async fn export(source: Source, opts: ExportOptions) -> Result<()> {
    if opts.size == 0 {
        bail!("--size must be at least 1");
    }
    prepare_out_dir(&opts)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("observing-species-id-bench")
        .build()?;

    let mut skipped = Skipped::new();
    let (source_label, candidates, media, api_base) = match &source {
        Source::Db { url, media_base } => {
            let pool = connect(url).await?;
            let candidates = list_db(&pool, &mut skipped).await?;
            let media = match media_base {
                Some(base) => Media::Appview {
                    client: client.clone(),
                    base: trim_base(base),
                },
                None => Media::Pds {
                    resolver: BlobResolver::with_client(client.clone()),
                    pds: Mutex::new(HashMap::new()),
                },
            };
            ("db".to_string(), candidates, media, None)
        }
        Source::Api { base } => {
            let base = trim_base(base);
            let candidates = list_api(&client, &base, &mut skipped).await?;
            let media = Media::Appview {
                client: client.clone(),
                base: base.clone(),
            };
            (format!("api:{base}"), candidates, media, Some(base))
        }
    };
    let candidate_count = candidates.len();
    eprintln!("{candidate_count} candidates with a photo and a taxon at family rank or below");

    // Seeded order: sha256(seed:uri). Stable for a given seed, independent of
    // how the source happened to return rows.
    let mut ordered: Vec<(String, Candidate)> = candidates
        .into_iter()
        .map(|c| {
            let key = hex::encode(Sha256::digest(
                format!("{}:{}", opts.seed, c.occurrence_uri).as_bytes(),
            ));
            (key, c)
        })
        .collect();
    ordered.sort_by(|a, b| a.0.cmp(&b.0));

    let ctx = Ctx {
        client,
        api_base,
        media,
        min_identifiers: opts.min_identifiers,
    };
    let mut samples: Vec<Sample> = Vec::new();
    let images_dir = opts.out.join(dataset::IMAGES_DIR);
    {
        let mut stream =
            futures::stream::iter(ordered.into_iter().map(|(_, c)| ctx.materialize(c)))
                .buffered(opts.concurrency.max(1));
        while let Some(result) = stream.next().await {
            match result {
                Ok((sample, bytes)) => {
                    std::fs::write(opts.out.join(&sample.image), bytes)
                        .with_context(|| format!("writing image for {}", sample.id))?;
                    samples.push(sample);
                    if samples.len().is_multiple_of(25) {
                        eprintln!("  {} / {}", samples.len(), opts.size);
                    }
                    if samples.len() == opts.size {
                        break;
                    }
                }
                Err(reason) => skip(&mut skipped, reason),
            }
        }
    }
    if samples.is_empty() {
        bail!(
            "no observation met the agreement rule (min {} identifiers); nothing exported. Skipped: {skipped:?}",
            opts.min_identifiers
        );
    }
    if samples.len() < opts.size {
        eprintln!(
            "only {} observations qualified; the dataset is smaller than --size {}",
            samples.len(),
            opts.size
        );
    }

    dataset::write_samples(&opts.out, &samples)?;
    let manifest = Manifest {
        format_version: dataset::FORMAT_VERSION,
        source: source_label,
        seed: opts.seed,
        requested_size: opts.size,
        sample_count: samples.len(),
        min_identifiers: opts.min_identifiers,
        candidates: candidate_count,
        skipped,
        exported_at: chrono::Utc::now().to_rfc3339(),
        fingerprint: dataset::fingerprint(&samples),
    };
    dataset::write_json(&opts.out.join(dataset::MANIFEST_FILE), &manifest)?;
    let annotations = dataset::load_annotations(&opts.out)?;
    write_index(&opts.out, &manifest, &samples, &annotations)?;

    eprintln!(
        "wrote {} samples to {} (fingerprint {})",
        samples.len(),
        opts.out.display(),
        &manifest.fingerprint[..12]
    );
    if !manifest.skipped.is_empty() {
        eprintln!("skipped: {:?}", manifest.skipped);
    }
    eprintln!("images: {}", images_dir.display());
    Ok(())
}

fn prepare_out_dir(opts: &ExportOptions) -> Result<()> {
    let samples = opts.out.join(dataset::SAMPLES_FILE);
    if samples.exists() {
        if !opts.force {
            bail!(
                "{} already holds a dataset; pass --force to redraw it (annotations.json is kept)",
                opts.out.display()
            );
        }
        let images = opts.out.join(dataset::IMAGES_DIR);
        if images.exists() {
            std::fs::remove_dir_all(&images)?;
        }
    }
    std::fs::create_dir_all(opts.out.join(dataset::IMAGES_DIR))
        .with_context(|| format!("creating {}", opts.out.display()))?;
    Ok(())
}

fn trim_base(base: &str) -> String {
    base.trim_end_matches('/').to_string()
}

async fn connect(url: &str) -> Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(2)
        .after_connect(|conn, _| {
            Box::pin(async move {
                conn.execute("SET search_path TO ingester, appview, public")
                    .await?;
                Ok(())
            })
        })
        .connect(url)
        .await
        .context("connecting to Postgres")
}

/// Every occurrence with a community ID, its first photo, and the accepted
/// taxon's ancestry from the `taxa` cache.
const DB_CANDIDATES: &str = r#"
SELECT
    o.uri,
    o.did,
    o.associated_media,
    ST_Y(o.location::geometry) AS latitude,
    ST_X(o.location::geometry) AS longitude,
    o.organism_quantity,
    c.scientific_name AS community_name,
    t.taxon_key,
    t.scientific_name AS taxon_name,
    t.rank,
    t.kingdom, t.phylum, t.class, t."order", t.family, t.genus, t.species
FROM ingester.community_ids c
JOIN ingester.occurrences o ON o.uri = c.occurrence_uri
LEFT JOIN ingester.taxa t ON t.taxon_key = c.accepted_taxon_key
"#;

async fn list_db(pool: &PgPool, skipped: &mut Skipped) -> Result<Vec<Candidate>> {
    let rows = sqlx::query(DB_CANDIDATES)
        .fetch_all(pool)
        .await
        .context("listing community IDs")?;
    let mut candidates = Vec::new();
    for row in rows {
        let media: Option<serde_json::Value> = row.try_get("associated_media")?;
        let Some((image_cid, license)) = first_image(media) else {
            skip(skipped, "no_photo");
            continue;
        };
        let taxon_key: Option<i64> = row.try_get("taxon_key")?;
        let (Some(taxon_key), Some(name), Some(rank)) = (
            taxon_key,
            row.try_get::<Option<String>, _>("taxon_name")?,
            row.try_get::<Option<String>, _>("rank")?,
        ) else {
            skip(skipped, "taxon_not_resolved");
            continue;
        };
        let rank = rank.to_lowercase();
        let species: Option<String> = row.try_get("species")?;
        let taxon = Taxon {
            species: names::is_species_or_below(&rank)
                .then(|| species.as_deref().or(Some(&name)).and_then(names::binomial))
                .flatten(),
            scientific_name: name,
            rank,
            kingdom: row.try_get("kingdom")?,
            phylum: row.try_get("phylum")?,
            class: row.try_get("class")?,
            order: row.try_get("order")?,
            family: row.try_get("family")?,
            genus: row.try_get("genus")?,
            taxon_key: Some(taxon_key),
        };
        if taxon.family.is_none() {
            skip(skipped, "rank_above_family");
            continue;
        }
        candidates.push(Candidate {
            occurrence_uri: row.try_get("uri")?,
            did: row.try_get("did")?,
            image_cid,
            license,
            community_name: row
                .try_get::<Option<String>, _>("community_name")?
                .unwrap_or_default(),
            taxon,
            latitude: row.try_get("latitude")?,
            longitude: row.try_get("longitude")?,
            organism_quantity: row.try_get("organism_quantity")?,
            identifications: None,
        });
    }

    let uris: Vec<String> = candidates
        .iter()
        .map(|c| c.occurrence_uri.clone())
        .collect();
    let mut by_uri = observing_db::identifications::get_for_subjects_batch(pool, &uris)
        .await
        .context("loading identifications")?;
    for c in &mut candidates {
        c.identifications = Some(by_uri.remove(&c.occurrence_uri).unwrap_or_default());
    }
    Ok(candidates)
}

/// CID and license of the first photo in an `associated_media` array.
fn first_image(media: Option<serde_json::Value>) -> Option<(String, Option<String>)> {
    let entries: Vec<BlobEntry> = serde_json::from_value(media?).ok()?;
    let first = entries.into_iter().next()?;
    Some((first.image.ref_.cid().to_string(), first.license))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedPage {
    occurrences: Vec<ApiOccurrence>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiOccurrence {
    uri: String,
    observer: ApiObserver,
    community_id: Option<String>,
    effective_taxonomy: Option<ApiTaxonomy>,
    location: Option<ApiLocation>,
    organism_quantity: Option<String>,
    #[serde(default)]
    images: Vec<ApiImage>,
}

#[derive(Deserialize)]
struct ApiObserver {
    did: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiTaxonomy {
    scientific_name: String,
    taxon_id: Option<String>,
    rank: Option<String>,
    kingdom: Option<String>,
    phylum: Option<String>,
    class: Option<String>,
    order: Option<String>,
    family: Option<String>,
    genus: Option<String>,
}

#[derive(Deserialize)]
struct ApiLocation {
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
struct ApiImage {
    url: String,
    license: Option<String>,
}

#[derive(Deserialize)]
struct ApiIdentifications {
    identifications: Vec<IdentificationRow>,
}

async fn list_api(
    client: &reqwest::Client,
    base: &str,
    skipped: &mut Skipped,
) -> Result<Vec<Candidate>> {
    let mut candidates = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut req = client
            .get(format!("{base}/api/feeds/explore"))
            .query(&[("limit", "100"), ("quality", "HAS_CONSENSUS_ID,HAS_MEDIA")]);
        if let Some(c) = &cursor {
            req = req.query(&[("cursor", c)]);
        }
        let page: FeedPage = req
            .send()
            .await?
            .error_for_status()
            .context("listing the explore feed")?
            .json()
            .await?;
        let done = page.occurrences.is_empty() || page.cursor.is_none();
        for occ in page.occurrences {
            if let Some(c) = api_candidate(occ, skipped) {
                candidates.push(c);
            }
        }
        if done {
            break;
        }
        cursor = page.cursor;
    }
    Ok(candidates)
}

fn api_candidate(occ: ApiOccurrence, skipped: &mut Skipped) -> Option<Candidate> {
    let Some(image) = occ.images.into_iter().next() else {
        skip(skipped, "no_photo");
        return None;
    };
    // `/media/blob/{did}/{cid}`
    let image_cid = image.url.rsplit('/').next().unwrap_or_default().to_string();
    let (Some(community_name), Some(t)) = (occ.community_id, occ.effective_taxonomy) else {
        skip(skipped, "taxon_not_resolved");
        return None;
    };
    let Some(rank) = t.rank.map(|r| r.to_lowercase()) else {
        skip(skipped, "taxon_not_resolved");
        return None;
    };
    if t.family.is_none() {
        skip(skipped, "rank_above_family");
        return None;
    }
    let taxon = Taxon {
        species: names::is_species_or_below(&rank)
            .then(|| names::binomial(&t.scientific_name))
            .flatten(),
        taxon_key: t
            .taxon_id
            .as_deref()
            .and_then(|id| id.rsplit('/').next())
            .and_then(|k| k.parse().ok()),
        scientific_name: t.scientific_name,
        rank,
        kingdom: t.kingdom,
        phylum: t.phylum,
        class: t.class,
        order: t.order,
        family: t.family,
        genus: t.genus,
    };
    Some(Candidate {
        occurrence_uri: occ.uri,
        did: occ.observer.did,
        image_cid,
        license: image.license,
        community_name,
        taxon,
        latitude: occ.location.as_ref().map(|l| l.latitude),
        longitude: occ.location.as_ref().map(|l| l.longitude),
        organism_quantity: occ.organism_quantity,
        identifications: None,
    })
}

enum Media {
    Pds {
        resolver: BlobResolver,
        /// DID → PDS URL, so each author is resolved once.
        pds: Mutex<HashMap<String, String>>,
    },
    Appview {
        client: reqwest::Client,
        base: String,
    },
}

impl Media {
    async fn fetch(&self, did: &str, cid: &str) -> Result<Vec<u8>> {
        match self {
            Media::Appview { client, base } => Ok(client
                .get(format!("{base}/media/blob/{did}/{cid}"))
                .send()
                .await?
                .error_for_status()?
                .bytes()
                .await?
                .to_vec()),
            Media::Pds { resolver, pds } => {
                let cached = pds.lock().await.get(did).cloned();
                let pds_url = match cached {
                    Some(url) => url,
                    None => {
                        let parsed = Did::new_owned(did)
                            .map_err(|e| anyhow::anyhow!("invalid DID {did}: {e}"))?;
                        let url = resolver.resolve_pds_url(&parsed).await?;
                        pds.lock().await.insert(did.to_string(), url.clone());
                        url
                    }
                };
                Ok(resolver.fetch_blob(&pds_url, did, cid).await?.0)
            }
        }
    }
}

struct Ctx {
    client: reqwest::Client,
    api_base: Option<String>,
    media: Media,
    min_identifiers: usize,
}

impl Ctx {
    /// Check the agreement rule, then fetch the photo. Errors are skip reasons.
    async fn materialize(&self, c: Candidate) -> Result<(Sample, Vec<u8>), &'static str> {
        let identifications = match c.identifications {
            Some(ids) => ids,
            None => self
                .fetch_identifications(&c.occurrence_uri)
                .await
                .map_err(|_| "identifications_fetch_failed")?,
        };
        let (identifiers, agreeing) =
            agreement(&identifications, &c.community_name, self.min_identifiers)?;

        let bytes = self
            .media
            .fetch(&c.did, &c.image_cid)
            .await
            .map_err(|_| "photo_download_failed")?;
        let Some((mime_type, ext)) = sniff_image(&bytes) else {
            return Err("unsupported_image_format");
        };

        let id = dataset::sample_id(&c.occurrence_uri);
        let multi_organism_hint = c
            .organism_quantity
            .as_deref()
            .and_then(|q| q.trim().parse::<f64>().ok())
            .is_some_and(|q| q > 1.0);
        let sample = Sample {
            image: format!("{}/{id}.{ext}", dataset::IMAGES_DIR),
            id,
            occurrence_uri: c.occurrence_uri,
            image_cid: c.image_cid,
            mime_type: mime_type.to_string(),
            image_sha256: hex::encode(Sha256::digest(&bytes)),
            license: c.license,
            taxon: c.taxon,
            latitude: c.latitude,
            longitude: c.longitude,
            identifiers,
            agreeing,
            organism_quantity: c.organism_quantity,
            multi_organism_hint,
        };
        Ok((sample, bytes))
    }

    async fn fetch_identifications(&self, uri: &str) -> Result<Vec<IdentificationRow>> {
        let base = self
            .api_base
            .as_deref()
            .context("identifications are preloaded for the DB source")?;
        let resp: ApiIdentifications = self
            .client
            .get(format!("{base}/api/identifications/{uri}"))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp.identifications)
    }
}

/// `(identifiers, agreeing)` when the community ID meets the rule, else why not.
fn agreement(
    identifications: &[IdentificationRow],
    community_name: &str,
    min_identifiers: usize,
) -> Result<(usize, usize), &'static str> {
    let Some(result) = community_ids::calculate(identifications) else {
        return Err("no_identifications");
    };
    if !result.scientific_name.eq_ignore_ascii_case(community_name) {
        // A tie the matview broke differently, or a name/synonym mismatch.
        return Err("community_id_ambiguous");
    }
    if result.identification_count < min_identifiers {
        return Err("too_few_identifiers");
    }
    if result.confidence < AGREEMENT_THRESHOLD {
        return Err("no_two_thirds_agreement");
    }
    let agreeing = (result.confidence * result.identification_count as f64).round() as usize;
    Ok((result.identification_count, agreeing))
}

/// MIME type and file extension, for the formats species-id decodes.
fn sniff_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

/// A contact sheet for reviewing photos and finding sample ids to `flag`.
fn write_index(
    dir: &std::path::Path,
    manifest: &Manifest,
    samples: &[Sample],
    annotations: &BTreeMap<String, Annotation>,
) -> Result<()> {
    let esc = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let mut html = String::from(
        "<!doctype html><meta charset=utf-8><title>species-id bench dataset</title>\
         <style>body{font:14px system-ui;margin:16px}\
         .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}\
         figure{margin:0}img{width:100%;aspect-ratio:1;object-fit:contain;background:#eee}\
         figcaption{font-size:12px}code{font-size:12px}</style>",
    );
    html.push_str(&format!(
        "<h1>{} samples</h1><p>source <code>{}</code>, seed {}, min identifiers {}, fingerprint <code>{}</code></p>\
         <p>Flag a photo with <code>species-id-bench flag &lt;dir&gt; &lt;id&gt; --multi</code> or <code>--crop x,y,w,h</code>.</p><div class=grid>",
        samples.len(),
        esc(&manifest.source),
        manifest.seed,
        manifest.min_identifiers,
        &manifest.fingerprint[..12],
    ));
    for s in samples {
        let flags = annotations
            .get(&s.id)
            .map(|a| esc(&serde_json::to_string(a).unwrap_or_default()))
            .unwrap_or_default();
        html.push_str(&format!(
            "<figure><img loading=lazy src=\"{}\"><figcaption><code>{}</code> <i>{}</i> ({})<br>{} · {}/{} agree{}{}</figcaption></figure>",
            esc(&s.image),
            s.id,
            esc(&s.taxon.scientific_name),
            esc(&s.taxon.rank),
            esc(s.taxon.kingdom.as_deref().unwrap_or("?")),
            s.agreeing,
            s.identifiers,
            if s.multi_organism_hint { " · count &gt; 1" } else { "" },
            if flags.is_empty() { String::new() } else { format!("<br><code>{flags}</code>") },
        ));
    }
    html.push_str("</div>\n");
    std::fs::write(dir.join(dataset::INDEX_FILE), html)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn id(did: &str, name: &str, day: u32) -> IdentificationRow {
        IdentificationRow {
            uri: format!("at://{did}/id/{day}"),
            cid: "c".into(),
            did: did.into(),
            subject_uri: "at://occ".into(),
            subject_cid: "c".into(),
            scientific_name: name.into(),
            taxon_rank: Some("species".into()),
            identification_qualifier: None,
            taxon_id: None,
            identification_verification_status: None,
            type_status: None,
            date_identified: Utc.with_ymd_and_hms(2026, 1, day, 0, 0, 0).unwrap(),
            kingdom: None,
            phylum: None,
            class: None,
            order_: None,
            family: None,
            genus: None,
        }
    }

    #[test]
    fn research_grade_needs_two_identifiers() {
        let one = [id("did:a", "Quercus agrifolia", 1)];
        assert_eq!(
            agreement(&one, "Quercus agrifolia", 2),
            Err("too_few_identifiers")
        );
        assert_eq!(agreement(&one, "Quercus agrifolia", 1), Ok((1, 1)));

        let two = [
            id("did:a", "Quercus agrifolia", 1),
            id("did:b", "Quercus agrifolia", 2),
        ];
        assert_eq!(agreement(&two, "Quercus agrifolia", 2), Ok((2, 2)));
    }

    #[test]
    fn needs_two_thirds() {
        let split = [
            id("did:a", "Quercus agrifolia", 1),
            id("did:b", "Quercus agrifolia", 2),
            id("did:c", "Quercus kelloggii", 3),
            id("did:d", "Quercus lobata", 4),
        ];
        assert_eq!(
            agreement(&split, "Quercus agrifolia", 2),
            Err("no_two_thirds_agreement")
        );
    }

    #[test]
    fn latest_id_per_user_counts() {
        // did:a changed their mind; only the latest pick counts.
        let ids = [
            id("did:a", "Quercus kelloggii", 1),
            id("did:a", "Quercus agrifolia", 5),
            id("did:b", "Quercus agrifolia", 2),
        ];
        assert_eq!(agreement(&ids, "Quercus agrifolia", 2), Ok((2, 2)));
    }

    #[test]
    fn sniffs_supported_formats() {
        assert_eq!(
            sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(("image/jpeg", "jpg"))
        );
        assert_eq!(
            sniff_image(b"\x89PNG\r\n\x1a\n...."),
            Some(("image/png", "png"))
        );
        assert_eq!(
            sniff_image(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(("image/webp", "webp"))
        );
        assert_eq!(sniff_image(b"\0\0\0\x18ftypheic"), None);
    }
}
