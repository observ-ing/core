//! Turning an occurrence into an iNaturalist observation.

use inaturalist::v2::models::Taxon;

/// The ID of the one taxon in `taxa` whose name is exactly `name` (ignoring
/// case) at `rank`. Without a rank, the name alone must single one out.
#[allow(dead_code)] // for the cross-post worker, which lands separately (#878)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn taxon(id: i32, name: &str, rank: &str) -> Taxon {
        Taxon {
            name: Some(name.into()),
            rank: Some(rank.into()),
            ..Taxon::new(id)
        }
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
}
