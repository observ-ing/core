//! `run`: post every sample's photo to one or more species-id endpoints and
//! record what came back, one results file per endpoint.
//!
//! Endpoints run one after another, never interleaved, so two services on
//! the same machine don't skew each other's latency.

use crate::dataset::{self, Dataset, Taxon};
use anyhow::{bail, Context, Result};
use base64::Engine;
use futures::StreamExt;
use observing_species_id_protocol::SpeciesSuggestion;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{Duration, Instant};

pub const RUN_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct Endpoint {
    pub name: String,
    pub url: String,
}

impl FromStr for Endpoint {
    type Err = anyhow::Error;

    /// `name=url`, or a bare `url` named after its host and port.
    fn from_str(s: &str) -> Result<Self> {
        let (name, url) = match s.split_once('=') {
            Some((name, url)) if !name.contains('/') => (name.to_string(), url.to_string()),
            _ => {
                let parsed = reqwest::Url::parse(s).context("endpoint must be a URL")?;
                let host = parsed.host_str().unwrap_or("endpoint");
                let name = match parsed.port() {
                    Some(port) => format!("{host}-{port}"),
                    None => host.to_string(),
                };
                (name, s.to_string())
            }
        };
        if name.is_empty() || name.contains(['/', '\\']) {
            bail!("endpoint name {name:?} must be non-empty and contain no slashes");
        }
        reqwest::Url::parse(&url).with_context(|| format!("endpoint {name}: bad URL {url}"))?;
        Ok(Endpoint {
            name,
            url: url.trim_end_matches('/').to_string(),
        })
    }
}

pub struct RunOptions {
    pub dataset: PathBuf,
    pub endpoints: Vec<Endpoint>,
    pub limit: usize,
    pub concurrency: usize,
    pub location: bool,
    pub crop: bool,
    pub warmup: usize,
    pub max_samples: Option<usize>,
    pub out_dir: Option<PathBuf>,
    pub timeout: Duration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFile {
    pub format_version: u32,
    pub name: String,
    pub endpoint: String,
    pub started_at: String,
    pub finished_at: String,
    pub model_version: Option<String>,
    pub species_count: Option<u64>,
    pub settings: RunSettings,
    pub dataset: DatasetRef,
    pub samples: Vec<SampleResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSettings {
    pub limit: usize,
    pub concurrency: usize,
    pub location: bool,
    pub crop: bool,
    pub warmup: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetRef {
    pub path: String,
    pub source: String,
    pub fingerprint: String,
    pub sample_count: usize,
}

/// One sample's outcome. Carries its ground truth and grouping so a results
/// file can be reported on without the dataset at hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleResult {
    pub id: String,
    pub taxon: Taxon,
    pub organisms: String,
    pub sent_location: bool,
    pub sent_crop: bool,
    /// Wall-clock time for the whole request, as a client sees it.
    pub latency_ms: f64,
    /// The service's own `inferenceTimeMs`.
    pub inference_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub suggestions: Vec<SpeciesSuggestion>,
    /// The broader taxon builds with rank fallback return when no species is
    /// confident. Absent from builds without it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<Fallback>,
}

/// `fallback` from `/identify`, read loosely so the bench doesn't depend on
/// a protocol version that has it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fallback {
    /// `genus`, `family`, `order`, `class`, `phylum` or `kingdom`.
    pub rank: String,
    pub scientific_name: String,
    #[serde(default)]
    pub confidence: Option<f64>,
}

/// The parts of an `/identify` response the bench reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentifyResponse {
    suggestions: Vec<SpeciesSuggestion>,
    #[serde(default)]
    fallback: Option<Fallback>,
    inference_time_ms: u64,
}

pub async fn run(opts: RunOptions) -> Result<Vec<(PathBuf, RunFile)>> {
    let ds = Dataset::load(&opts.dataset)?;
    let mut work: Vec<_> = ds
        .samples
        .iter()
        .filter(|s| !ds.annotations.get(&s.id).is_some_and(|a| a.exclude))
        .collect();
    let excluded = ds.samples.len() - work.len();
    if let Some(max) = opts.max_samples {
        work.truncate(max);
    }
    if work.is_empty() {
        bail!("no samples to run");
    }
    eprintln!(
        "{} samples from {}{}",
        work.len(),
        opts.dataset.display(),
        if excluded > 0 {
            format!(" ({excluded} excluded by annotations)")
        } else {
            String::new()
        }
    );

    let out_dir = opts
        .out_dir
        .clone()
        .unwrap_or_else(|| opts.dataset.join("runs"));
    std::fs::create_dir_all(&out_dir)?;
    let client = reqwest::Client::builder().timeout(opts.timeout).build()?;
    let dataset_ref = DatasetRef {
        path: opts.dataset.display().to_string(),
        source: ds.manifest.source.clone(),
        fingerprint: ds.manifest.fingerprint.clone(),
        sample_count: ds.samples.len(),
    };

    let mut written = Vec::new();
    for endpoint in &opts.endpoints {
        eprintln!("\n== {} ({})", endpoint.name, endpoint.url);
        let (model_version, species_count) = health(&client, &endpoint.url).await?;
        eprintln!(
            "model {} with {} species",
            model_version.as_deref().unwrap_or("?"),
            species_count.map_or("?".to_string(), |n| n.to_string())
        );

        for sample in work.iter().take(opts.warmup) {
            let body = request_body(&ds.dir, sample, None, false, opts.limit)?;
            let _ = identify(&client, &endpoint.url, &body).await;
        }

        let started_at = chrono::Utc::now();
        let total = work.len();
        let mut done = 0usize;
        let mut results: Vec<(usize, SampleResult)> = Vec::with_capacity(total);
        let mut stream = futures::stream::iter(work.iter().enumerate().map(|(i, sample)| {
            let client = &client;
            let ds = &ds;
            let opts = &opts;
            async move {
                let annotation = ds.annotations.get(&sample.id);
                let crop = opts.crop.then(|| annotation.and_then(|a| a.crop)).flatten();
                let send_location =
                    opts.location && sample.latitude.is_some() && sample.longitude.is_some();
                let mut result = SampleResult {
                    id: sample.id.clone(),
                    taxon: sample.taxon.clone(),
                    organisms: dataset::organisms_group(sample, annotation).to_string(),
                    sent_location: send_location,
                    sent_crop: crop.is_some(),
                    latency_ms: 0.0,
                    inference_ms: None,
                    error: None,
                    suggestions: Vec::new(),
                    fallback: None,
                };
                match request_body(&ds.dir, sample, crop, send_location, opts.limit) {
                    Err(e) => result.error = Some(format!("{e:#}")),
                    Ok(body) => {
                        let start = Instant::now();
                        let outcome = identify(client, &endpoint.url, &body).await;
                        result.latency_ms = start.elapsed().as_secs_f64() * 1000.0;
                        match outcome {
                            Ok(resp) => {
                                result.inference_ms = Some(resp.inference_time_ms);
                                result.suggestions = resp.suggestions;
                                result.fallback = resp.fallback;
                            }
                            Err(e) => result.error = Some(format!("{e:#}")),
                        }
                    }
                }
                (i, result)
            }
        }))
        .buffer_unordered(opts.concurrency.max(1));
        while let Some(item) = stream.next().await {
            done += 1;
            if let Some(err) = &item.1.error {
                eprintln!("  {}: {err}", item.1.id);
            }
            if done.is_multiple_of(25) || done == total {
                eprintln!("  {done} / {total}");
            }
            results.push(item);
        }
        drop(stream);
        results.sort_by_key(|(i, _)| *i);

        let run = RunFile {
            format_version: RUN_FORMAT_VERSION,
            name: endpoint.name.clone(),
            endpoint: endpoint.url.clone(),
            started_at: started_at.to_rfc3339(),
            finished_at: chrono::Utc::now().to_rfc3339(),
            model_version,
            species_count,
            settings: RunSettings {
                limit: opts.limit,
                concurrency: opts.concurrency,
                location: opts.location,
                crop: opts.crop,
                warmup: opts.warmup,
            },
            dataset: dataset_ref.clone(),
            samples: results.into_iter().map(|(_, r)| r).collect(),
        };
        let path = out_dir.join(format!(
            "{}-{}.json",
            started_at.format("%Y%m%dT%H%M%SZ"),
            endpoint.name
        ));
        dataset::write_json(&path, &run)?;
        eprintln!("results: {}", path.display());
        written.push((path, run));
    }
    Ok(written)
}

/// `(model_version, species_count)` from `/health`, when it says.
async fn health(client: &reqwest::Client, url: &str) -> Result<(Option<String>, Option<u64>)> {
    let resp = client
        .get(format!("{url}/health"))
        .send()
        .await
        .with_context(|| format!("{url} is not answering; is species-id running?"))?;
    if !resp.status().is_success() {
        bail!("{url}/health returned {}", resp.status());
    }
    let v: serde_json::Value = resp.json().await.unwrap_or_default();
    let field = |snake: &str, camel: &str| v.get(snake).or_else(|| v.get(camel)).cloned();
    Ok((
        field("model_version", "modelVersion").and_then(|v| v.as_str().map(str::to_string)),
        field("species_count", "speciesCount").and_then(|v| v.as_u64()),
    ))
}

fn request_body(
    dir: &Path,
    sample: &dataset::Sample,
    crop: Option<dataset::Crop>,
    send_location: bool,
    limit: usize,
) -> Result<serde_json::Value> {
    let bytes = std::fs::read(dir.join(&sample.image))
        .with_context(|| format!("reading {}", sample.image))?;
    let mut body = serde_json::json!({
        "image": base64::engine::general_purpose::STANDARD.encode(bytes),
        "limit": limit,
    });
    if send_location {
        body["latitude"] = sample.latitude.into();
        body["longitude"] = sample.longitude.into();
    }
    if let Some(crop) = crop {
        // Accepted by builds that support cropping; older ones ignore it.
        body["crop"] = serde_json::to_value(crop)?;
    }
    Ok(body)
}

async fn identify(
    client: &reqwest::Client,
    url: &str,
    body: &serde_json::Value,
) -> Result<IdentifyResponse> {
    let resp = client
        .post(format!("{url}/identify"))
        .json(body)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        bail!(
            "HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        );
    }
    resp.json().await.context("decoding /identify response")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_parsing() {
        let e: Endpoint = "main=http://localhost:3005/".parse().unwrap();
        assert_eq!(e.name, "main");
        assert_eq!(e.url, "http://localhost:3005");

        let e: Endpoint = "http://localhost:3006".parse().unwrap();
        assert_eq!(e.name, "localhost-3006");

        assert!("main=not a url".parse::<Endpoint>().is_err());
    }
}
