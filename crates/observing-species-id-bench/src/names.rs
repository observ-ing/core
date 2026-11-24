//! Name normalization shared by export (ground truth) and report (scoring).

/// GBIF ranks at or below species.
const SPECIES_OR_BELOW: &[&str] = &[
    "species",
    "subspecies",
    "variety",
    "subvariety",
    "form",
    "subform",
    "infraspecific_name",
    "infrasubspecific_name",
];

pub fn is_species_or_below(rank: &str) -> bool {
    SPECIES_OR_BELOW.contains(&rank.to_lowercase().as_str())
}

/// The lowercase "genus epithet" of a scientific name, dropping anything
/// after it (infraspecific epithets, authorship). Hybrid markers are skipped
/// so `Quercus × alvordiana` matches `Quercus alvordiana`. `None` for a
/// single-word name.
pub fn binomial(name: &str) -> Option<String> {
    let mut words = name.split_whitespace().filter(|w| !matches!(*w, "×" | "x"));
    let genus = words.next()?;
    let epithet = words.next()?;
    Some(format!(
        "{} {}",
        genus.to_lowercase(),
        epithet.to_lowercase()
    ))
}

/// Case-insensitive equality of two optional names; `None` never matches.
pub fn same(a: Option<&str>, b: Option<&str>) -> bool {
    matches!((a, b), (Some(a), Some(b)) if a.trim().eq_ignore_ascii_case(b.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binomial_normalizes() {
        assert_eq!(
            binomial("Quercus agrifolia var. oxyadenia").as_deref(),
            Some("quercus agrifolia")
        );
        assert_eq!(
            binomial("Anas  Platyrhynchos").as_deref(),
            Some("anas platyrhynchos")
        );
        assert_eq!(
            binomial("Quercus × alvordiana").as_deref(),
            Some("quercus alvordiana")
        );
        assert_eq!(binomial("Quercus"), None);
    }

    #[test]
    fn ranks() {
        assert!(is_species_or_below("SPECIES"));
        assert!(is_species_or_below("subspecies"));
        assert!(!is_species_or_below("genus"));
    }

    #[test]
    fn same_ignores_case() {
        assert!(same(Some("Fagaceae"), Some("fagaceae")));
        assert!(!same(None, None));
        assert!(!same(Some("Fagaceae"), None));
    }
}
