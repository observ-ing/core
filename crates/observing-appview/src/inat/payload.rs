//! Turning an occurrence into an iNaturalist observation.

use inaturalist::v2::models::{ObservationsCreateObservation, Taxon};
use observing_db::taxon_uri::{self, TaxonRef};
use uuid::Uuid;

/// What to tell iNaturalist about the taxon.
#[derive(Debug, Clone, PartialEq)]
pub enum TaxonChoice {
    /// An iNaturalist taxon we are sure of.
    Id(i32),
    /// A name for iNaturalist to interpret. Used when we can't pin the name to
    /// one iNaturalist taxon; guessing an ID would misidentify the observation.
    Guess(String),
    Unknown,
}

/// The occurrence fields an observation is built from.
#[derive(Debug, Clone, Default)]
pub struct OccurrenceFields<'a> {
    pub event_date: Option<&'a str>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub coordinate_uncertainty_meters: Option<i32>,
}

/// The iNaturalist taxon ID named by a Darwin Core `taxonID`, if it is an
/// iNaturalist taxon URI.
pub fn inat_taxon_id(taxon_id: &str) -> Option<i32> {
    match taxon_uri::parse(taxon_id) {
        TaxonRef::INaturalist(id) => id.parse().ok(),
        _ => None,
    }
}

/// The ID of the one taxon in `taxa` whose name is exactly `name` (ignoring
/// case) at `rank`. Without a rank, the name alone must single one out.
pub fn exact_taxon_match(taxa: &[Taxon], name: &str, rank: Option<&str>) -> Option<i32> {
    let mut matches = taxa.iter().filter(|taxon| {
        let same_name = taxon
            .name
            .as_deref()
            .is_some_and(|n| n.eq_ignore_ascii_case(name));
        let same_rank = rank.is_none_or(|rank| {
            taxon
                .rank
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(rank))
        });
        same_name && same_rank
    });
    let first = matches.next()?;
    matches.next().is_none().then_some(first.id)
}

/// iNaturalist has no date intervals, so an `eventDate` interval is posted as
/// its start.
pub fn observed_on(event_date: &str) -> &str {
    event_date.split('/').next().unwrap_or(event_date)
}

pub fn build_observation(
    uuid: Uuid,
    occurrence: &OccurrenceFields,
    taxon: TaxonChoice,
) -> ObservationsCreateObservation {
    let (taxon_id, species_guess) = match taxon {
        TaxonChoice::Id(id) => (Some(id), None),
        TaxonChoice::Guess(name) => (None, Some(name)),
        TaxonChoice::Unknown => (None, None),
    };
    // A latitude without a longitude is not a location.
    let coordinates = occurrence.latitude.zip(occurrence.longitude);
    ObservationsCreateObservation {
        uuid: Some(uuid),
        observed_on_string: occurrence.event_date.map(|d| observed_on(d).to_string()),
        latitude: coordinates.map(|(latitude, _)| latitude),
        longitude: coordinates.map(|(_, longitude)| longitude),
        positional_accuracy: occurrence.coordinate_uncertainty_meters.map(f64::from),
        taxon_id,
        species_guess,
        ..Default::default()
    }
}

/// A file name for an uploaded photo. iNaturalist uses the extension as a hint.
pub fn photo_file_name(blob_cid: &str, mime_type: &str) -> String {
    let extension = match mime_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/heic" => "heic",
        _ => return blob_cid.to_string(),
    };
    format!("{blob_cid}.{extension}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn taxon(id: i32, name: &str, rank: &str) -> Taxon {
        Taxon {
            name: Some(name.into()),
            rank: Some(rank.into()),
            ..Taxon::new(id)
        }
    }

    #[test]
    fn reads_an_inaturalist_taxon_uri() {
        assert_eq!(
            inat_taxon_id("https://www.inaturalist.org/taxa/48484"),
            Some(48484)
        );
    }

    #[test]
    fn ignores_taxon_ids_from_other_authorities() {
        assert_eq!(inat_taxon_id("https://www.gbif.org/species/2880791"), None);
        assert_eq!(inat_taxon_id("gbif:2880791"), None);
    }

    #[test]
    fn matches_a_name_at_the_same_rank_ignoring_case() {
        let taxa = [
            taxon(1, "Harmonia", "genus"),
            taxon(2, "Harmonia axyridis", "species"),
        ];
        assert_eq!(
            exact_taxon_match(&taxa, "harmonia AXYRIDIS", Some("Species")),
            Some(2)
        );
    }

    #[test]
    fn rejects_a_near_miss() {
        let taxa = [taxon(2, "Harmonia axyridis", "species")];
        assert_eq!(
            exact_taxon_match(&taxa, "Harmonia axyridi", Some("species")),
            None
        );
        assert_eq!(
            exact_taxon_match(&taxa, "Harmonia axyridis", Some("subspecies")),
            None
        );
    }

    #[test]
    fn rejects_a_name_shared_by_two_taxa_at_the_rank() {
        // Homonyms across kingdoms, e.g. the plant and insect genera Ficus.
        let taxa = [taxon(1, "Ficus", "genus"), taxon(2, "Ficus", "genus")];
        assert_eq!(exact_taxon_match(&taxa, "Ficus", Some("genus")), None);
    }

    #[test]
    fn without_a_rank_the_name_must_be_unique() {
        let unique = [
            taxon(1, "Harmonia", "genus"),
            taxon(2, "Harmonia axyridis", "species"),
        ];
        assert_eq!(exact_taxon_match(&unique, "Harmonia", None), Some(1));

        let ambiguous = [taxon(1, "Ficus", "genus"), taxon(2, "Ficus", "section")];
        assert_eq!(exact_taxon_match(&ambiguous, "Ficus", None), None);
    }

    #[test]
    fn observed_on_takes_the_start_of_an_interval() {
        assert_eq!(observed_on("1995-05-21/1995-05-23"), "1995-05-21");
        assert_eq!(
            observed_on("2026-10-06T09:30:00-07:00/2026-10-06T10:00:00-07:00"),
            "2026-10-06T09:30:00-07:00"
        );
    }

    #[test]
    fn observed_on_passes_a_single_date_through() {
        assert_eq!(observed_on("2026-10-06"), "2026-10-06");
        assert_eq!(observed_on("1971"), "1971");
    }

    #[test]
    fn builds_an_observation_with_a_known_taxon() {
        let uuid = Uuid::from_u128(1);
        let observation = build_observation(
            uuid,
            &OccurrenceFields {
                event_date: Some("2026-10-06/2026-10-07"),
                latitude: Some(37.8),
                longitude: Some(-122.27),
                coordinate_uncertainty_meters: Some(25),
            },
            TaxonChoice::Id(48484),
        );
        assert_eq!(
            serde_json::to_value(&observation).unwrap(),
            json!({
                "uuid": uuid,
                "observed_on_string": "2026-10-06",
                "latitude": 37.8,
                "longitude": -122.27,
                "positional_accuracy": 25.0,
                "taxon_id": 48484,
            })
        );
    }

    #[test]
    fn sends_an_unmatched_name_as_a_guess() {
        let observation = build_observation(
            Uuid::from_u128(1),
            &OccurrenceFields::default(),
            TaxonChoice::Guess("Harmonia axyridis".into()),
        );
        assert_eq!(observation.taxon_id, None);
        assert_eq!(
            observation.species_guess.as_deref(),
            Some("Harmonia axyridis")
        );
    }

    #[test]
    fn omits_what_the_occurrence_lacks() {
        let uuid = Uuid::from_u128(1);
        let observation =
            build_observation(uuid, &OccurrenceFields::default(), TaxonChoice::Unknown);
        assert_eq!(
            serde_json::to_value(&observation).unwrap(),
            json!({ "uuid": uuid })
        );
    }

    #[test]
    fn names_photos_by_cid_with_an_extension_for_the_type() {
        assert_eq!(photo_file_name("bafkrei1", "image/jpeg"), "bafkrei1.jpg");
        assert_eq!(photo_file_name("bafkrei1", "image/png"), "bafkrei1.png");
        assert_eq!(photo_file_name("bafkrei1", "image/webp"), "bafkrei1.webp");
        assert_eq!(photo_file_name("bafkrei1", "application/weird"), "bafkrei1");
    }
}
