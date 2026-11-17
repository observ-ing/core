//! Thumbnail generation for `/media/thumb`.
//!
//! Photo grids ask for thumbnails; serving them the 2000–3000 px originals
//! (several MB each) left tiles blank for seconds. A thumbnail here is the
//! original decoded, turned upright by its EXIF orientation (the re-encoded
//! JPEG carries no EXIF, so it has to be baked into the pixels), shrunk to
//! [`THUMB_MAX_EDGE`] on its long edge and re-encoded as JPEG.

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageDecoder, ImageReader, Limits};

/// Long edge of a thumbnail, in pixels. Grid tiles are ~200–300 CSS px, so
/// this stays sharp on 2x displays while weighing tens of KB, not MB.
pub const THUMB_MAX_EDGE: u32 = 600;

/// JPEG quality for thumbnails. Small previews hide compression well.
const THUMB_JPEG_QUALITY: u8 = 80;

/// Decoding allocates the full-size pixel buffer; refuse anything that
/// would need more than this (a 48 MP RGBA photo is ~190 MB).
const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;

/// Content type of every generated thumbnail.
pub const THUMB_CONTENT_TYPE: &str = "image/jpeg";

/// Version of the thumbnail recipe, part of the cache key so changing the
/// size or quality doesn't serve stale thumbnails from the disk cache.
const THUMB_VARIANT: &str = "thumb-v1-600";

/// The `cid` under which a blob's thumbnail is stored in the shared
/// [`file_blob_cache::BlobCache`]. Can't collide with a real CID.
pub fn thumb_cache_cid(cid: &str) -> String {
    format!("{cid}#{THUMB_VARIANT}")
}

/// Make a JPEG thumbnail from encoded image bytes (JPEG, PNG or WebP).
///
/// CPU-bound: call it from `spawn_blocking`.
pub fn make_thumbnail(data: &[u8]) -> Result<Vec<u8>, image::ImageError> {
    let mut reader = ImageReader::new(Cursor::new(data)).with_guessed_format()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);

    let mut decoder = reader.into_decoder()?;
    // A missing or unreadable orientation shouldn't cost the thumbnail.
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);

    if img.width().max(img.height()) > THUMB_MAX_EDGE {
        // `thumbnail` keeps the aspect ratio and fits within the box.
        img = img.thumbnail(THUMB_MAX_EDGE, THUMB_MAX_EDGE);
    }

    // JPEG has no alpha channel.
    let rgb = DynamicImage::ImageRgb8(img.to_rgb8());
    let mut out = Vec::new();
    rgb.write_with_encoder(JpegEncoder::new_with_quality(&mut out, THUMB_JPEG_QUALITY))?;
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use image::{ImageEncoder, ImageFormat, RgbImage};

    /// A minimal little-endian TIFF/EXIF block holding only an Orientation
    /// tag (0x0112) with the given value.
    fn exif_with_orientation(value: u16) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"II*\0");
        v.extend_from_slice(&8u32.to_le_bytes()); // offset of IFD0
        v.extend_from_slice(&1u16.to_le_bytes()); // one entry
        v.extend_from_slice(&0x0112u16.to_le_bytes()); // Orientation
        v.extend_from_slice(&3u16.to_le_bytes()); // SHORT
        v.extend_from_slice(&1u32.to_le_bytes()); // count
        v.extend_from_slice(&value.to_le_bytes());
        v.extend_from_slice(&[0, 0]); // pad value to 4 bytes
        v.extend_from_slice(&0u32.to_le_bytes()); // no next IFD
        v
    }

    /// A `width`×`height` JPEG, optionally tagged with an EXIF orientation.
    /// The left half is red and the right half blue, so a rotation shows up
    /// as the colours moving to the top/bottom.
    pub(crate) fn test_jpeg(width: u32, height: u32, orientation: Option<u16>) -> Vec<u8> {
        let img = RgbImage::from_fn(width, height, |x, _| {
            if x < width / 2 {
                image::Rgb([255, 0, 0])
            } else {
                image::Rgb([0, 0, 255])
            }
        });
        let mut out = Vec::new();
        let mut enc = JpegEncoder::new_with_quality(&mut out, 90);
        if let Some(o) = orientation {
            enc.set_exif_metadata(exif_with_orientation(o)).unwrap();
        }
        enc.write_image(img.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .unwrap();
        out
    }

    fn decode(data: &[u8]) -> DynamicImage {
        image::load_from_memory_with_format(data, ImageFormat::Jpeg).unwrap()
    }

    #[test]
    fn shrinks_long_edge_and_keeps_aspect_ratio() {
        let thumb = make_thumbnail(&test_jpeg(3000, 2000, None)).unwrap();
        let img = decode(&thumb);
        assert_eq!((img.width(), img.height()), (600, 400));
    }

    #[test]
    fn small_images_are_not_upscaled() {
        let thumb = make_thumbnail(&test_jpeg(300, 200, None)).unwrap();
        let img = decode(&thumb);
        assert_eq!((img.width(), img.height()), (300, 200));
    }

    #[test]
    fn applies_exif_orientation() {
        // Orientation 6: stored landscape, displayed rotated 90° clockwise.
        let thumb = make_thumbnail(&test_jpeg(1200, 800, Some(6))).unwrap();
        let img = decode(&thumb).to_rgb8();
        assert_eq!((img.width(), img.height()), (400, 600));
        // Rotating clockwise moves the stored left (red) half to the top.
        let top = img.get_pixel(200, 50);
        let bottom = img.get_pixel(200, 550);
        assert!(top[0] > 200 && top[2] < 60, "top should be red: {top:?}");
        assert!(
            bottom[2] > 200 && bottom[0] < 60,
            "bottom should be blue: {bottom:?}"
        );
    }

    #[test]
    fn converts_png_with_alpha_to_jpeg() {
        let img = image::RgbaImage::from_pixel(1000, 1000, image::Rgba([10, 200, 10, 128]));
        let mut png = Vec::new();
        DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .unwrap();
        let thumb = make_thumbnail(&png).unwrap();
        assert_eq!(image::guess_format(&thumb).unwrap(), ImageFormat::Jpeg);
        let img = decode(&thumb);
        assert_eq!((img.width(), img.height()), (600, 600));
    }

    #[test]
    fn rejects_non_images() {
        assert!(make_thumbnail(b"definitely not an image").is_err());
    }

    #[test]
    fn thumb_cache_cid_differs_from_original() {
        assert_ne!(thumb_cache_cid("bafyabc"), "bafyabc");
    }
}
