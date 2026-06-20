//! Per-occurrence quality issues, in the style of GBIF's data-quality flags.
//!
//! An occurrence is "verifiable" when [`compute_issues`] returns an empty list.
//! Callers can filter feeds on this in SQL (see [`feeds`](crate::feeds)) and
//! surface individual codes in API responses for UI badges.

use crate::types::OccurrenceRow;
use serde::de::value::{Error as ValueError, StrDeserializer};
use serde::de::{self, Deserializer, IntoDeserializer};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
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

/// A single data-quality criterion a feed row can be required to meet. Each is
/// the positive counterpart of a [`QualityIssue`] — a row meets the criterion
/// when the corresponding issue is *absent* (see [`compute_issues`]).
///
/// [`PreciseLocation`](QualityCriterion::PreciseLocation) additionally implies
/// the location is present, mirroring the observation data-quality checklist:
/// precision can't be "met" when there are no coordinates at all (the issue is
/// suppressed in that case rather than reported).
///
/// The serde representation is the single source of truth for the wire tokens:
/// it is exported to the frontend as `bindings/QualityCriterion.ts` and reused
/// by [`FromStr`] below, so the UI, the `?quality=` parser, and the generated
/// type can't drift.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export, export_to = "bindings/", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QualityCriterion {
    /// `eventDate` is present (no [`QualityIssue::MissingDate`]).
    HasDate,
    /// Coordinates are present (no [`QualityIssue::MissingLocation`]).
    HasLocation,
    /// Coordinates are present and precise (no `MissingLocation` /
    /// `CoordinatesImprecise`).
    PreciseLocation,
    /// At least one photo or sound (no [`QualityIssue::MissingMedia`]).
    HasMedia,
    /// A consensus identification exists (no [`QualityIssue::NoConsensusId`]).
    HasConsensusId,
}

impl QualityCriterion {
    /// Every criterion, in checklist order. The `complete` shorthand selects
    /// exactly this set — a row meeting all of them has no quality issues.
    pub const ALL: [QualityCriterion; 5] = [
        QualityCriterion::HasDate,
        QualityCriterion::HasLocation,
        QualityCriterion::PreciseLocation,
        QualityCriterion::HasMedia,
        QualityCriterion::HasConsensusId,
    ];
}

impl FromStr for QualityCriterion {
    type Err = String;

    /// Parse a single wire token via the derived [`Deserialize`], so the
    /// accepted tokens always match the serde / TS representation.
    fn from_str(token: &str) -> Result<Self, Self::Err> {
        let de: StrDeserializer<ValueError> = token.into_deserializer();
        Self::deserialize(de).map_err(|_| format!("unknown quality criterion: {token}"))
    }
}

/// Parsed `?quality=` value: the set of criteria every returned row must meet.
///
/// The wire format is a comma-separated list of [`QualityCriterion`] tokens
/// (e.g. `HAS_MEDIA,HAS_CONSENSUS_ID`), with `complete` as shorthand for
/// [`QualityCriterion::ALL`]. An empty selection applies no filter. Unknown
/// tokens fail to parse, which axum surfaces as a 400 rather than silently
/// dropping the filter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QualitySelection {
    pub criteria: Vec<QualityCriterion>,
}

impl QualitySelection {
    pub fn is_empty(&self) -> bool {
        self.criteria.is_empty()
    }
}

impl FromStr for QualitySelection {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut criteria = Vec::new();
        let mut push = |c: QualityCriterion| {
            if !criteria.contains(&c) {
                criteria.push(c);
            }
        };
        for token in s.split(',') {
            let token = token.trim();
            if token.is_empty() {
                continue;
            }
            if token == "complete" {
                QualityCriterion::ALL.into_iter().for_each(&mut push);
                continue;
            }
            push(token.parse()?);
        }
        Ok(QualitySelection { criteria })
    }
}

impl<'de> Deserialize<'de> for QualitySelection {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        raw.parse().map_err(de::Error::custom)
    }
}

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
            event_date: Some("2024-06-15".into()),
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
            organism_quantity: None,
            organism_quantity_type: None,
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

    #[test]
    fn parses_individual_criteria_preserving_order() {
        let sel: QualitySelection = "HAS_MEDIA,HAS_CONSENSUS_ID".parse().unwrap();
        assert_eq!(
            sel.criteria,
            vec![QualityCriterion::HasMedia, QualityCriterion::HasConsensusId]
        );
    }

    #[test]
    fn complete_expands_to_all_criteria() {
        let sel: QualitySelection = "complete".parse().unwrap();
        assert_eq!(sel.criteria, QualityCriterion::ALL.to_vec());
    }

    #[test]
    fn dedupes_and_skips_blanks() {
        let sel: QualitySelection = "HAS_DATE, ,HAS_DATE,HAS_MEDIA".parse().unwrap();
        assert_eq!(
            sel.criteria,
            vec![QualityCriterion::HasDate, QualityCriterion::HasMedia]
        );
    }

    #[test]
    fn empty_string_is_empty_selection() {
        let sel: QualitySelection = "".parse().unwrap();
        assert!(sel.is_empty());
    }

    #[test]
    fn unknown_token_is_rejected() {
        assert!("HAS_DATE,bogus".parse::<QualitySelection>().is_err());
    }

    #[test]
    fn token_parsing_matches_serde_representation() {
        // FromStr must accept exactly what serde emits for every criterion,
        // guarding the StrDeserializer-based parse against drift.
        for criterion in QualityCriterion::ALL {
            let token = serde_json::to_value(criterion).unwrap();
            let token = token.as_str().unwrap();
            assert_eq!(token.parse::<QualityCriterion>().unwrap(), criterion);
        }
    }
}
