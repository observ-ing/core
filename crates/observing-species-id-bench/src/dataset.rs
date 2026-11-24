//! The on-disk dataset: what `export` writes and `run` reads.
//!
//! ```text
//! <dir>/
//!   dataset.json       how the set was drawn (source, seed, size, rule, skips)
//!   samples.jsonl      one ground-truth sample per line
//!   images/<id>.<ext>  the photo each sample scores
//!   annotations.json   hand-made flags (multi-organism, crop, exclude); optional
//!   index.html         contact sheet for reviewing photos and picking ids to flag
//! ```
//!
//! Annotations live apart from the samples so that re-exporting never drops
//! review work, and so they can be edited by hand or with `flag`.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

pub const MANIFEST_FILE: &str = "dataset.json";
pub const SAMPLES_FILE: &str = "samples.jsonl";
pub const ANNOTATIONS_FILE: &str = "annotations.json";
pub const INDEX_FILE: &str = "index.html";
pub const IMAGES_DIR: &str = "images";

pub const FORMAT_VERSION: u32 = 1;

/// How the dataset was drawn. Enough to redraw it from the same source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format_version: u32,
    /// `db` or `api:<base url>`.
    pub source: String,
    pub seed: u64,
    pub requested_size: usize,
    pub sample_count: usize,
    /// Minimum number of distinct identifiers behind the community ID.
    pub min_identifiers: usize,
    /// Observations that passed every cheap filter (media, rank, taxon)
    /// before sampling.
    pub candidates: usize,
    /// Why candidates looked at during sampling were dropped, by reason.
    pub skipped: BTreeMap<String, usize>,
    pub exported_at: String,
    /// Hash over every sample's id and image bytes. Two runs scored the same
    /// photos exactly when their fingerprints match.
    pub fingerprint: String,
}

/// The accepted taxon for a sample, with its Linnaean ancestry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Taxon {
    pub scientific_name: String,
    /// Lowercase GBIF rank: `species`, `subspecies`, `genus`, `family`, ...
    pub rank: String,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    /// Binomial, set when the taxon is at species rank or below.
    pub species: Option<String>,
    /// GBIF usage key of the accepted taxon, when known.
    pub taxon_key: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// First 12 hex chars of sha256(occurrence URI). Stable across exports.
    pub id: String,
    pub occurrence_uri: String,
    /// Path of the photo, relative to the dataset directory.
    pub image: String,
    pub image_cid: String,
    pub mime_type: String,
    pub image_sha256: String,
    pub license: Option<String>,
    pub taxon: Taxon,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    /// Distinct identifiers (each user's latest ID counts once).
    pub identifiers: usize,
    /// How many of them agree with the community taxon.
    pub agreeing: usize,
    pub organism_quantity: Option<String>,
    /// The observer counted more than one organism. A hint for review, not a
    /// flag: several individuals of one species is still "one taxon".
    pub multi_organism_hint: bool,
}

/// A crop rectangle in fractions (0–1) of the image's width and height.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Crop {
    pub fn validate(&self) -> Result<()> {
        let in_unit = |v: f64| (0.0..=1.0).contains(&v);
        if !(in_unit(self.x) && in_unit(self.y) && in_unit(self.width) && in_unit(self.height)) {
            bail!("crop values must be fractions between 0 and 1");
        }
        if self.width == 0.0 || self.height == 0.0 {
            bail!("crop width and height must be greater than 0");
        }
        if self.x + self.width > 1.0 + 1e-9 || self.y + self.height > 1.0 + 1e-9 {
            bail!("crop must lie inside the image (x + width <= 1, y + height <= 1)");
        }
        Ok(())
    }
}

impl std::str::FromStr for Crop {
    type Err = anyhow::Error;

    /// `x,y,width,height`, each a fraction of the image.
    fn from_str(s: &str) -> Result<Self> {
        let parts: Vec<f64> = s
            .split(',')
            .map(|p| p.trim().parse::<f64>())
            .collect::<Result<_, _>>()
            .context("crop must be four numbers: x,y,width,height")?;
        let [x, y, width, height] = parts[..] else {
            bail!("crop must be four numbers: x,y,width,height");
        };
        let crop = Crop {
            x,
            y,
            width,
            height,
        };
        crop.validate()?;
        Ok(crop)
    }
}

/// Hand-made review flags for one sample.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    /// More than one organism in frame (`true`), exactly one (`false`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multi_organism: Option<bool>,
    /// The region holding the organism the community identified. Sent to the
    /// service as `crop` when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Crop>,
    /// Leave the sample out of runs (wrong photo, unidentifiable, ...).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub exclude: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl Annotation {
    pub fn is_empty(&self) -> bool {
        *self == Annotation::default()
    }
}

/// How a sample is grouped in the report's organism breakdown.
pub fn organisms_group(sample: &Sample, annotation: Option<&Annotation>) -> &'static str {
    match annotation.and_then(|a| a.multi_organism) {
        Some(true) => "several (flagged)",
        Some(false) => "one (flagged)",
        None if sample.multi_organism_hint => "several? (count > 1)",
        None => "not reviewed",
    }
}

pub struct Dataset {
    pub dir: PathBuf,
    pub manifest: Manifest,
    pub samples: Vec<Sample>,
    pub annotations: BTreeMap<String, Annotation>,
}

impl Dataset {
    pub fn load(dir: &Path) -> Result<Self> {
        let manifest: Manifest = read_json(&dir.join(MANIFEST_FILE))?;
        if manifest.format_version != FORMAT_VERSION {
            bail!(
                "{} has format version {}, this tool reads {FORMAT_VERSION}",
                dir.display(),
                manifest.format_version
            );
        }
        let samples_path = dir.join(SAMPLES_FILE);
        let file = std::fs::File::open(&samples_path)
            .with_context(|| format!("opening {}", samples_path.display()))?;
        let mut samples = Vec::new();
        for (i, line) in BufReader::new(file).lines().enumerate() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            samples.push(
                serde_json::from_str(&line)
                    .with_context(|| format!("{}:{}", samples_path.display(), i + 1))?,
            );
        }
        let annotations = load_annotations(dir)?;
        Ok(Self {
            dir: dir.to_path_buf(),
            manifest,
            samples,
            annotations,
        })
    }
}

pub fn load_annotations(dir: &Path) -> Result<BTreeMap<String, Annotation>> {
    let path = dir.join(ANNOTATIONS_FILE);
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    read_json(&path)
}

pub fn save_annotations(dir: &Path, annotations: &BTreeMap<String, Annotation>) -> Result<()> {
    write_json(&dir.join(ANNOTATIONS_FILE), annotations)
}

pub fn write_samples(dir: &Path, samples: &[Sample]) -> Result<()> {
    let mut out = std::io::BufWriter::new(std::fs::File::create(dir.join(SAMPLES_FILE))?);
    for sample in samples {
        serde_json::to_writer(&mut out, sample)?;
        out.write_all(b"\n")?;
    }
    out.flush()?;
    Ok(())
}

pub fn fingerprint(samples: &[Sample]) -> String {
    let mut lines: Vec<String> = samples
        .iter()
        .map(|s| format!("{}:{}", s.id, s.image_sha256))
        .collect();
    lines.sort();
    let mut hasher = Sha256::new();
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    hex::encode(hasher.finalize())
}

pub fn sample_id(occurrence_uri: &str) -> String {
    hex::encode(Sha256::digest(occurrence_uri.as_bytes()))[..12].to_string()
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_slice(&bytes).with_context(|| format!("parsing {}", path.display()))
}

pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    std::fs::write(path, bytes).with_context(|| format!("writing {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_parses_and_validates() {
        let crop: Crop = "0.1, 0.2, 0.5, 0.5".parse().unwrap();
        assert_eq!(
            crop,
            Crop {
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.5
            }
        );
        assert!(
            "0.6,0,0.5,1".parse::<Crop>().is_err(),
            "runs off the right edge"
        );
        assert!("0,0,0,1".parse::<Crop>().is_err(), "zero width");
        assert!("0,0,1".parse::<Crop>().is_err(), "three numbers");
        assert!("0,0,1.5,1".parse::<Crop>().is_err(), "not a fraction");
    }

    #[test]
    fn empty_annotation_serializes_to_empty_object() {
        assert_eq!(serde_json::to_string(&Annotation::default()).unwrap(), "{}");
    }

    #[test]
    fn sample_id_is_stable() {
        assert_eq!(
            sample_id("at://did:plc:x/col/1"),
            sample_id("at://did:plc:x/col/1")
        );
        assert_eq!(sample_id("at://did:plc:x/col/1").len(), 12);
    }
}
