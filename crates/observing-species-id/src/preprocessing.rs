//! Image preprocessing for BioCLIP inference
//!
//! BioCLIP uses standard CLIP ViT-B/16 preprocessing:
//! - Resize to 224x224 (bicubic)
//! - Convert to RGB float32 in [0, 1]
//! - Normalize with CLIP mean/std
//! - NCHW tensor layout

use crate::error::{Result, SpeciesIdError};
use ndarray::Array4;

/// CLIP normalization constants
const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];

const INPUT_SIZE: u32 = 224;

/// Decode an image from bytes and preprocess it for BioCLIP inference.
///
/// Returns an NCHW tensor of shape `[1, 3, 224, 224]`.
pub fn preprocess_image(bytes: &[u8]) -> Result<Array4<f32>> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| SpeciesIdError::Image(format!("Failed to decode image: {}", e)))?;

    let img = img.resize_exact(
        INPUT_SIZE,
        INPUT_SIZE,
        image::imageops::FilterType::CatmullRom,
    );
    let rgb = img.to_rgb8();

    let mut tensor = Array4::<f32>::zeros((1, 3, INPUT_SIZE as usize, INPUT_SIZE as usize));

    for y in 0..INPUT_SIZE as usize {
        for x in 0..INPUT_SIZE as usize {
            let pixel = rgb.get_pixel(x as u32, y as u32);
            for c in 0..3 {
                let val = pixel[c] as f32 / 255.0;
                tensor[[0, c, y, x]] = (val - MEAN[c]) / STD[c];
            }
        }
    }

    Ok(tensor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preprocess_creates_correct_shape() {
        // Create a minimal 2x2 red JPEG in memory
        let mut buf = Vec::new();
        let img = image::RgbImage::from_pixel(2, 2, image::Rgb([255, 0, 0]));
        let mut cursor = std::io::Cursor::new(&mut buf);
        img.write_to(&mut cursor, image::ImageFormat::Png).unwrap();

        let tensor = preprocess_image(&buf).unwrap();
        assert_eq!(tensor.shape(), &[1, 3, 224, 224]);
    }

    #[test]
    fn test_preprocess_normalizes_values() {
        let mut buf = Vec::new();
        // Pure white image
        let img = image::RgbImage::from_pixel(4, 4, image::Rgb([255, 255, 255]));
        let mut cursor = std::io::Cursor::new(&mut buf);
        img.write_to(&mut cursor, image::ImageFormat::Png).unwrap();

        let tensor = preprocess_image(&buf).unwrap();

        // For pure white (1.0), normalized value = (1.0 - mean) / std
        let expected_r = (1.0 - MEAN[0]) / STD[0];
        let actual = tensor[[0, 0, 0, 0]];
        assert!((actual - expected_r).abs() < 0.01);
    }
}
