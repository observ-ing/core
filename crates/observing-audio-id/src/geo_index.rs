//! H3-cell-keyed geo index for audio class ranges.
//!
//! Identical shape to `observing-species-id`'s geo index — same on-disk
//! format, same lookup. Kept as a sibling rather than shared because the
//! class-index space is different (Perch's ~15k classes vs BioCLIP's GBIF
//! list), so the prebuilt `.bin` is service-specific.
//!
//! TODO: factor out into a small shared `observing-geo-index` crate once a
//! second consumer (this one) is real and stable; until then duplication
//! is cheaper than the abstraction.

use crate::error::{AudioIdError, Result};
use h3o::{LatLng, Resolution};
use std::path::Path;
use tracing::info;

const GEO_RESOLUTION: Resolution = Resolution::Three;

pub struct GeoIndex {
    /// Stub — populated by the load routine from the same flat-binary
    /// layout the species-id service uses (H3 cell index → sorted slice of
    /// class indices).
    _placeholder: (),
}

impl GeoIndex {
    pub fn load(path: &Path, _num_classes: usize) -> Result<Self> {
        info!(path = %path.display(), "Loading audio-id geo index");
        // Skeleton: real implementation mirrors
        // observing-species-id/src/geo_index.rs — memmap, validate header,
        // expose `species_at(lat, lon) -> &[u32]`.
        Err(AudioIdError::Config(
            "geo index loading not yet implemented; rerun with the artifact absent to skip".into(),
        ))
    }

    pub fn species_at(&self, lat: f64, lon: f64) -> &[u32] {
        let _cell = LatLng::new(lat, lon)
            .ok()
            .map(|p| p.to_cell(GEO_RESOLUTION));
        &[]
    }
}
