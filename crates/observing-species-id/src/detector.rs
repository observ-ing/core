//! Organism detection (prototype): find the living things in a photo.
//!
//! Runs an OWLv2 open-vocabulary detector exported to ONNX by
//! `crates/observing-species-id/scripts/export_detector.py`. The ONNX graph is
//! the image side of OWLv2 only; the text side is replaced by query
//! embeddings computed once at export time (`detector_queries.json`), the
//! same way `/identify` uses precomputed species text embeddings.
//!
//! Several prompts can share one label ("a photo of a bee" and "a photo of a
//! butterfly" both map to `insect`): OWLv2 finds concrete nouns far better
//! than abstract ones like "insect" or "amphibian". A box's score for a label
//! is the best score among that label's prompts.
//!
//! See docs/organism-detection.md for how the model was chosen.

use crate::error::{Result, SpeciesIdError};
use image::{DynamicImage, ImageDecoder, ImageReader};
use ndarray::{Array2, Array4, ArrayView2};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Value;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use std::sync::Mutex;
use tracing::info;

/// CLIP normalization constants (OWLv2 uses the same as BioCLIP).
const MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
const STD: [f32; 3] = [0.268_629_54, 0.261_302_6, 0.275_777_1];

/// OWLv2 pads the image to a square with mid-gray (0.5 before normalization).
const PAD_VALUE: f32 = 0.5;

/// Boxes overlapping a higher-scoring box by at least this IoU are dropped,
/// whatever their label: the client wants one box per organism to tap.
const NMS_IOU: f32 = 0.5;

/// A box as fractions (0–1) of the image after its EXIF rotation is applied:
/// the same convention as `/identify`'s `crop`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FractionBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl FractionBox {
    fn area(&self) -> f32 {
        self.width * self.height
    }

    fn iou(&self, other: &FractionBox) -> f32 {
        let x1 = self.x.max(other.x);
        let y1 = self.y.max(other.y);
        let x2 = (self.x + self.width).min(other.x + other.width);
        let y2 = (self.y + self.height).min(other.y + other.height);
        let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
        let union = self.area() + other.area() - inter;
        if union > 0.0 {
            inter / union
        } else {
            0.0
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Detection {
    /// Coarse group, e.g. `insect`, `flower`, `bird`.
    pub label: String,
    /// Sigmoid score of the best-matching prompt for `label`, 0–1.
    pub score: f32,
    #[serde(rename = "box")]
    pub bbox: FractionBox,
}

#[derive(Deserialize)]
struct QueriesFile {
    image_size: u32,
    #[serde(default)]
    model: Option<String>,
    queries: Vec<Query>,
}

#[derive(Deserialize)]
struct Query {
    label: String,
    embedding: Vec<f32>,
}

pub struct OrganismDetector {
    session: Mutex<Session>,
    /// `[num_queries, embed_dim]`, L2-normalized.
    query_embeds: Array2<f32>,
    /// For each query, its index into `labels`.
    query_label: Vec<usize>,
    labels: Vec<String>,
    image_size: u32,
    pub version: String,
}

impl OrganismDetector {
    /// Load `{dir}/detector.onnx` and `{dir}/detector_queries.json`.
    pub fn load(dir: &Path) -> Result<Self> {
        let queries_path = dir.join("detector_queries.json");
        let file: QueriesFile = serde_json::from_slice(&std::fs::read(&queries_path)?)
            .map_err(|e| SpeciesIdError::Config(format!("{}: {}", queries_path.display(), e)))?;
        let (query_embeds, query_label, labels) = build_queries(&file.queries)?;

        let onnx_path = dir.join("detector.onnx");
        info!(path = %onnx_path.display(), "Loading organism detector");
        let session = Session::builder()
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?
            .with_intra_threads(4)
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?
            .commit_from_file(&onnx_path)
            .map_err(|e| {
                SpeciesIdError::Model(format!(
                    "Failed to load detector from {}: {}",
                    onnx_path.display(),
                    e
                ))
            })?;

        let version = std::env::var("DETECTOR_VERSION").unwrap_or_else(|_| {
            let base = file
                .model
                .as_deref()
                .and_then(|m| m.rsplit('/').next())
                .unwrap_or("owlv2");
            format!("{}-{}", base, file.image_size)
        });
        info!(
            queries = query_label.len(),
            labels = labels.len(),
            image_size = file.image_size,
            %version,
            "Organism detector loaded"
        );

        Ok(Self {
            session: Mutex::new(session),
            query_embeds,
            query_label,
            labels,
            image_size: file.image_size,
            version,
        })
    }

    /// Detect organisms in raw image bytes. Boxes are fractions of the image
    /// after EXIF rotation, sorted by descending score.
    pub fn detect(
        &self,
        image_bytes: &[u8],
        min_score: f32,
        limit: usize,
    ) -> Result<Vec<Detection>> {
        let img = decode_oriented(image_bytes)?;
        let (width, height) = (img.width(), img.height());
        let input = preprocess(&img, self.image_size);

        let input_value = Value::from_array(input)
            .map_err(|e| SpeciesIdError::Model(format!("Failed to create input tensor: {}", e)))?;
        let query_value = Value::from_array(self.query_embeds.clone())
            .map_err(|e| SpeciesIdError::Model(format!("Failed to create query tensor: {}", e)))?;

        let mut session = self
            .session
            .lock()
            .map_err(|e| SpeciesIdError::Model(format!("Session lock poisoned: {}", e)))?;
        let outputs = session
            .run(ort::inputs![
                "pixel_values" => input_value,
                "query_embeds" => query_value,
            ])
            .map_err(|e| SpeciesIdError::Model(format!("Detection failed: {}", e)))?;

        let (score_shape, scores) = outputs["scores"]
            .try_extract_tensor::<f32>()
            .map_err(|e| SpeciesIdError::Model(format!("Failed to extract scores: {}", e)))?;
        let (box_shape, boxes) = outputs["boxes"]
            .try_extract_tensor::<f32>()
            .map_err(|e| SpeciesIdError::Model(format!("Failed to extract boxes: {}", e)))?;
        let num_queries = self.query_label.len();
        if score_shape.len() != 2
            || score_shape[1] != num_queries as i64
            || box_shape.len() != 2
            || box_shape[0] != score_shape[0]
            || box_shape[1] != 4
        {
            return Err(SpeciesIdError::Model(format!(
                "Unexpected detector output shapes: scores {:?}, boxes {:?}",
                &**score_shape, &**box_shape
            )));
        }
        let num_patches = score_shape[0] as usize;
        let scores = ArrayView2::from_shape((num_patches, num_queries), scores)
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?;
        let boxes = ArrayView2::from_shape((num_patches, 4), boxes)
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?;

        Ok(self.postprocess(scores, boxes, width, height, min_score, limit))
    }

    fn postprocess(
        &self,
        scores: ArrayView2<f32>,
        boxes: ArrayView2<f32>,
        width: u32,
        height: u32,
        min_score: f32,
        limit: usize,
    ) -> Vec<Detection> {
        // Best label per patch, scoring a label by its best prompt.
        let mut candidates: Vec<(usize, usize, f32)> = Vec::new();
        let mut per_label = vec![0f32; self.labels.len()];
        for (patch, row) in scores.outer_iter().enumerate() {
            per_label.fill(0.0);
            for (q, &s) in row.iter().enumerate() {
                let l = self.query_label[q];
                per_label[l] = per_label[l].max(s);
            }
            let (label, &score) = per_label
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.total_cmp(b.1))
                .expect("at least one label");
            if score >= min_score {
                candidates.push((patch, label, score));
            }
        }
        candidates.sort_by(|a, b| b.2.total_cmp(&a.2));

        // OWLv2 predicts boxes relative to the padded square, whose side is
        // the image's longer edge.
        let side = width.max(height) as f32;
        let sx = side / width as f32;
        let sy = side / height as f32;

        let mut kept: Vec<Detection> = Vec::new();
        for (patch, label, score) in candidates {
            if kept.len() >= limit {
                break;
            }
            let b = boxes.row(patch);
            let Some(bbox) = to_fraction_box([b[0], b[1], b[2], b[3]], sx, sy) else {
                continue;
            };
            if kept.iter().all(|k| k.bbox.iou(&bbox) < NMS_IOU) {
                kept.push(Detection {
                    label: self.labels[label].clone(),
                    score,
                    bbox,
                });
            }
        }
        kept
    }
}

/// Group queries by label, keeping labels in first-seen order.
fn build_queries(queries: &[Query]) -> Result<(Array2<f32>, Vec<usize>, Vec<String>)> {
    let dim = queries
        .first()
        .map(|q| q.embedding.len())
        .ok_or_else(|| SpeciesIdError::Config("detector_queries.json has no queries".into()))?;
    let mut labels: Vec<String> = Vec::new();
    let mut query_label = Vec::with_capacity(queries.len());
    let mut embeds = Array2::<f32>::zeros((queries.len(), dim));
    for (i, q) in queries.iter().enumerate() {
        if q.embedding.len() != dim {
            return Err(SpeciesIdError::Config(format!(
                "query {} has embedding length {}, expected {}",
                i,
                q.embedding.len(),
                dim
            )));
        }
        let idx = match labels.iter().position(|l| *l == q.label) {
            Some(idx) => idx,
            None => {
                labels.push(q.label.clone());
                labels.len() - 1
            }
        };
        query_label.push(idx);
        let norm = q
            .embedding
            .iter()
            .map(|x| x * x)
            .sum::<f32>()
            .sqrt()
            .max(1e-6);
        for (j, &x) in q.embedding.iter().enumerate() {
            embeds[[i, j]] = x / norm;
        }
    }
    Ok((embeds, query_label, labels))
}

/// Convert an OWLv2 `(cx, cy, w, h)` box, as fractions of the padded square,
/// to fractions of the image, clamped to it. `None` if nothing is left.
fn to_fraction_box([cx, cy, w, h]: [f32; 4], sx: f32, sy: f32) -> Option<FractionBox> {
    let x1 = ((cx - w / 2.0) * sx).clamp(0.0, 1.0);
    let y1 = ((cy - h / 2.0) * sy).clamp(0.0, 1.0);
    let x2 = ((cx + w / 2.0) * sx).clamp(0.0, 1.0);
    let y2 = ((cy + h / 2.0) * sy).clamp(0.0, 1.0);
    (x2 > x1 && y2 > y1).then_some(FractionBox {
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
    })
}

/// Decode an image and apply its EXIF orientation, so boxes line up with the
/// image as the user sees it.
pub fn decode_oriented(bytes: &[u8]) -> Result<DynamicImage> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .into_decoder()
        .map_err(|e| SpeciesIdError::Image(format!("Failed to decode image: {}", e)))?;
    let orientation = decoder.orientation()?;
    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|e| SpeciesIdError::Image(format!("Failed to decode image: {}", e)))?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// Scale the image so its longer edge is `size`, place it at the top-left of
/// a `size`×`size` mid-gray square (OWLv2's padding), and normalize to an
/// NCHW tensor.
fn preprocess(img: &DynamicImage, size: u32) -> Array4<f32> {
    let side = img.width().max(img.height()) as f32;
    let w = ((img.width() as f32 * size as f32 / side).round() as u32).clamp(1, size);
    let h = ((img.height() as f32 * size as f32 / side).round() as u32).clamp(1, size);
    let rgb = img
        .resize_exact(w, h, image::imageops::FilterType::Triangle)
        .to_rgb8();

    let n = size as usize;
    let mut tensor = Array4::<f32>::zeros((1, 3, n, n));
    for c in 0..3 {
        tensor
            .slice_mut(ndarray::s![0, c, .., ..])
            .fill((PAD_VALUE - MEAN[c]) / STD[c]);
    }
    for (x, y, pixel) in rgb.enumerate_pixels() {
        for c in 0..3 {
            let v = pixel[c] as f32 / 255.0;
            tensor[[0, c, y as usize, x as usize]] = (v - MEAN[c]) / STD[c];
        }
    }
    tensor
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(label: &str, embedding: Vec<f32>) -> Query {
        Query {
            label: label.into(),
            embedding,
        }
    }

    #[test]
    fn build_queries_groups_labels_and_normalizes() {
        let (embeds, query_label, labels) = build_queries(&[
            q("insect", vec![3.0, 4.0]),
            q("flower", vec![1.0, 0.0]),
            q("insect", vec![0.0, 2.0]),
        ])
        .unwrap();
        assert_eq!(labels, vec!["insect", "flower"]);
        assert_eq!(query_label, vec![0, 1, 0]);
        assert!((embeds[[0, 0]] - 0.6).abs() < 1e-6);
        assert!((embeds[[2, 1]] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn build_queries_rejects_mismatched_dims() {
        assert!(build_queries(&[q("a", vec![1.0, 0.0]), q("b", vec![1.0])]).is_err());
        assert!(build_queries(&[]).is_err());
    }

    #[test]
    fn fraction_box_undoes_square_padding() {
        // A landscape image 2:1 is padded to a square whose lower half is
        // gray, so a box covering the top half of the square covers all of
        // the image's height.
        let b = to_fraction_box([0.5, 0.25, 1.0, 0.5], 1.0, 2.0).unwrap();
        assert_eq!(
            b,
            FractionBox {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0
            }
        );
    }

    #[test]
    fn fraction_box_drops_boxes_in_padding() {
        assert!(to_fraction_box([0.5, 0.9, 0.2, 0.1], 1.0, 2.0).is_none());
    }

    #[test]
    fn iou_of_identical_and_disjoint_boxes() {
        let a = FractionBox {
            x: 0.0,
            y: 0.0,
            width: 0.5,
            height: 0.5,
        };
        let b = FractionBox { x: 0.5, ..a };
        assert!((a.iou(&a) - 1.0).abs() < 1e-6);
        assert_eq!(a.iou(&b), 0.0);
    }

    #[test]
    fn preprocess_pads_to_square_with_gray() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            40,
            20,
            image::Rgb([255, 255, 255]),
        ));
        let t = preprocess(&img, 16);
        assert_eq!(t.shape(), &[1, 3, 16, 16]);
        let white = (1.0 - MEAN[0]) / STD[0];
        let gray = (PAD_VALUE - MEAN[0]) / STD[0];
        assert!((t[[0, 0, 0, 15]] - white).abs() < 1e-4);
        assert!((t[[0, 0, 7, 0]] - white).abs() < 1e-4);
        assert!((t[[0, 0, 8, 0]] - gray).abs() < 1e-4);
    }

    #[test]
    fn decode_oriented_applies_exif_rotation() {
        // 4×2 JPEG with EXIF orientation 6 (rotate 90° clockwise) decodes
        // to a 2×4 image.
        let mut jpeg = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::new(4, 2))
            .write_to(&mut Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
            .unwrap();
        let with_exif = insert_exif_orientation(&jpeg, 6);
        let img = decode_oriented(&with_exif).unwrap();
        assert_eq!((img.width(), img.height()), (2, 4));
        let plain = decode_oriented(&jpeg).unwrap();
        assert_eq!((plain.width(), plain.height()), (4, 2));
    }

    /// End-to-end run against an exported detector. Needs the model files and
    /// ONNX Runtime:
    ///
    ///     DETECTOR_DIR=models/detector DETECT_TEST_IMAGE=photo.jpg \
    ///       cargo test -p observing-species-id detector -- --ignored --nocapture
    #[test]
    #[ignore = "needs DETECTOR_DIR and DETECT_TEST_IMAGE"]
    fn detect_with_exported_model() {
        let dir = std::env::var("DETECTOR_DIR").expect("DETECTOR_DIR");
        let image = std::env::var("DETECT_TEST_IMAGE").expect("DETECT_TEST_IMAGE");
        let detector = OrganismDetector::load(Path::new(&dir)).unwrap();
        let bytes = std::fs::read(image).unwrap();
        let start = std::time::Instant::now();
        let detections = detector.detect(&bytes, 0.2, 20).unwrap();
        println!("{:?} in {:?}", detections, start.elapsed());
        assert!(!detections.is_empty());
        for d in &detections {
            let b = d.bbox;
            assert!(b.x >= 0.0 && b.y >= 0.0 && b.width > 0.0 && b.height > 0.0);
            assert!(b.x + b.width <= 1.0 + 1e-6 && b.y + b.height <= 1.0 + 1e-6);
        }
    }

    /// Insert a minimal APP1 Exif segment holding only an Orientation tag
    /// right after the JPEG SOI marker.
    fn insert_exif_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"MM\0\x2a\0\0\0\x08"); // big-endian, IFD at 8
        tiff.extend_from_slice(&1u16.to_be_bytes()); // one entry
        tiff.extend_from_slice(&0x0112u16.to_be_bytes()); // Orientation
        tiff.extend_from_slice(&3u16.to_be_bytes()); // SHORT
        tiff.extend_from_slice(&1u32.to_be_bytes()); // count
        tiff.extend_from_slice(&orientation.to_be_bytes());
        tiff.extend_from_slice(&[0, 0]); // pad value to 4 bytes
        tiff.extend_from_slice(&0u32.to_be_bytes()); // no next IFD
        let mut payload = b"Exif\0\0".to_vec();
        payload.extend_from_slice(&tiff);
        let mut out = jpeg[..2].to_vec();
        out.extend_from_slice(&[0xFF, 0xE1]);
        out.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(&payload);
        out.extend_from_slice(&jpeg[2..]);
        out
    }
}
