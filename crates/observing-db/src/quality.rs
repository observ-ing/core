//! Per-occurrence quality issues, in the style of GBIF's data-quality flags.
//!
//! An occurrence is "verifiable" when [`compute_issues`] returns an empty list.
//! Callers can filter feeds on this in SQL (see [`feeds`](crate::feeds)) and
//! surface individual codes in API responses for UI badges.

use crate::types::OccurrenceRow;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export, export_to = "bindings/", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QualityIssue {
    /// `eventDate` is missing.
    MissingDate,
    /// `decimalLatitude`/`decimalLongitude` are missing.
    MissingLocation,
    /// `associatedMedia` is empty or unparseable.
    MissingMedia,
    /// Coordinates are present but `coordinateUncertaintyInMeters` is missing
    /// or larger than [`IMPRECISE_UNCERTAINTY_THRESHOLD_M`].
    CoordinatesImprecise,
    /// No row in `community_ids` — no consensus identification has emerged.
    NoConsensusId,
}

/// Matches iNaturalist's "obscured location" radius, so coordinates rounded
/// to roughly a state/province get flagged.
pub const IMPRECISE_UNCERTAINTY_THRESHOLD_M: i32 = 5000;

pub fn compute_issues(row: &OccurrenceRow, has_consensus_id: bool) -> Vec<QualityIssue> {
    let mut issues = Vec::new();

    if row.event_date.is_none() {
        issues.push(QualityIssue::MissingDate);
    }

    let has_location = row.latitude.is_some() && row.longitude.is_some();
    if !has_location {
        issues.push(QualityIssue::MissingLocation);
    } else {
        let imprecise = match row.coordinate_uncertainty_meters {
            None => true,
            Some(u) => u > IMPRECISE_UNCERTAINTY_THRESHOLD_M,
        };
        if imprecise {
            issues.push(QualityIssue::CoordinatesImprecise);
        }
    }

    if row.blob_entries().is_empty() {
        issues.push(QualityIssue::MissingMedia);
    }

    if !has_consensus_id {
        issues.push(QualityIssue::NoConsensusId);
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BlobEntry, BlobImage, BlobRef};
    use chrono::Utc;

    fn base_row() -> OccurrenceRow {
        OccurrenceRow {
            uri: "at://did:plc:test/x/1".into(),
            cid: "cid".into(),
            did: "did:plc:test".into(),
            scientific_name: None,
            event_date: Some(Utc::now()),
            latitude: Some(40.0),
            longitude: Some(-105.0),
            coordinate_uncertainty_meters: Some(10),
            associated_media: Some(blobs_json(1)),
            recorded_by: None,
            taxon_id: None,
            taxon_rank: None,
            kingdom: None,
            phylum: None,
            class: None,
            order_: None,
            family: None,
            genus: None,
            created_at: Utc::now(),
            distance_meters: None,
            source: None,
        }
    }

    fn blobs_json(n: usize) -> serde_json::Value {
        let entries: Vec<BlobEntry> = (0..n)
            .map(|i| BlobEntry {
                image: BlobImage {
                    ref_: BlobRef::Bare(format!("cid{i}")),
                    mime_type: "image/jpeg".into(),
                },
                alt: None,
                license: None,
            })
            .collect();
        serde_json::to_value(entries).unwrap()
    }

    #[test]
    fn fully_populated_row_with_consensus_has_no_issues() {
        let row = base_row();
        assert!(compute_issues(&row, true).is_empty());
    }

    #[test]
    fn missing_consensus_id_flags() {
        let row = base_row();
        assert_eq!(
            compute_issues(&row, false),
            vec![QualityIssue::NoConsensusId]
        );
    }

    #[test]
    fn missing_date_flags() {
        let mut row = base_row();
        row.event_date = None;
        let issues = compute_issues(&row, true);
        assert!(issues.contains(&QualityIssue::MissingDate));
    }

    #[test]
    fn missing_location_flags_and_suppresses_precision_check() {
        let mut row = base_row();
        row.latitude = None;
        row.longitude = None;
        row.coordinate_uncertainty_meters = None;
        let issues = compute_issues(&row, true);
        assert!(issues.contains(&QualityIssue::MissingLocation));
        assert!(!issues.contains(&QualityIssue::CoordinatesImprecise));
    }

    #[test]
    fn precise_coords_pass() {
        let mut row = base_row();
        row.coordinate_uncertainty_meters = Some(IMPRECISE_UNCERTAINTY_THRESHOLD_M);
        assert!(compute_issues(&row, true).is_empty());
    }

    #[test]
    fn coords_above_threshold_flag() {
        let mut row = base_row();
        row.coordinate_uncertainty_meters = Some(IMPRECISE_UNCERTAINTY_THRESHOLD_M + 1);
        assert_eq!(
            compute_issues(&row, true),
            vec![QualityIssue::CoordinatesImprecise]
        );
    }

    #[test]
    fn missing_uncertainty_flags_imprecise() {
        let mut row = base_row();
        row.coordinate_uncertainty_meters = None;
        assert_eq!(
            compute_issues(&row, true),
            vec![QualityIssue::CoordinatesImprecise]
        );
    }

    #[test]
    fn no_media_flags() {
        let mut row = base_row();
        row.associated_media = None;
        assert_eq!(compute_issues(&row, true), vec![QualityIssue::MissingMedia]);
    }

    #[test]
    fn empty_media_array_flags() {
        let mut row = base_row();
        row.associated_media = Some(blobs_json(0));
        assert_eq!(compute_issues(&row, true), vec![QualityIssue::MissingMedia]);
    }

    #[test]
    fn all_issues_flag_together() {
        let mut row = base_row();
        row.event_date = None;
        row.latitude = None;
        row.longitude = None;
        row.coordinate_uncertainty_meters = None;
        row.associated_media = None;
        let issues = compute_issues(&row, false);
        assert!(issues.contains(&QualityIssue::MissingDate));
        assert!(issues.contains(&QualityIssue::MissingLocation));
        assert!(issues.contains(&QualityIssue::MissingMedia));
        assert!(issues.contains(&QualityIssue::NoConsensusId));
        assert!(!issues.contains(&QualityIssue::CoordinatesImprecise));
    }

    #[test]
    fn serializes_to_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&QualityIssue::MissingDate).unwrap(),
            "\"MISSING_DATE\""
        );
        assert_eq!(
            serde_json::to_string(&QualityIssue::CoordinatesImprecise).unwrap(),
            "\"COORDINATES_IMPRECISE\""
        );
        assert_eq!(
            serde_json::to_string(&QualityIssue::NoConsensusId).unwrap(),
            "\"NO_CONSENSUS_ID\""
        );
    }
}
