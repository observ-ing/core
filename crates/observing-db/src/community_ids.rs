use crate::types::IdentificationRow;

/// Result of community ID calculation
#[derive(Debug, Clone)]
pub struct CommunityIdResult {
    pub scientific_name: String,
    pub kingdom: Option<String>,
    pub taxon_rank: Option<String>,
    pub identification_count: usize,
    pub agreement_count: usize,
    pub confidence: f64,
    pub is_research_grade: bool,
}

const RESEARCH_GRADE_THRESHOLD: f64 = 2.0 / 3.0;
const MIN_IDS_FOR_RESEARCH_GRADE: usize = 2;

/// Calculate the community ID from a set of identifications.
///
/// Implements iNaturalist-style consensus:
/// - Deduplicates by user (keeps most recent identification per user)
/// - Groups by taxon name + kingdom (avoids cross-kingdom homonyms)
/// - 2/3 majority required for research grade
pub fn calculate(identifications: &[IdentificationRow]) -> Option<CommunityIdResult> {
    if identifications.is_empty() {
        return None;
    }

    // Keep only each user's most recent identification
    let deduplicated = deduplicate_by_user(identifications);

    // Group by taxon
    let taxon_counts = group_by_taxon(&deduplicated);

    // Find winner
    let winner = find_winner(&taxon_counts)?;

    let confidence = winner.count as f64 / deduplicated.len() as f64;
    let is_research_grade =
        deduplicated.len() >= MIN_IDS_FOR_RESEARCH_GRADE && confidence >= RESEARCH_GRADE_THRESHOLD;

    Some(CommunityIdResult {
        scientific_name: winner.scientific_name.clone(),
        kingdom: winner.kingdom.clone(),
        taxon_rank: winner.taxon_rank.clone(),
        identification_count: deduplicated.len(),
        agreement_count: winner.count,
        confidence,
        is_research_grade,
    })
}

struct TaxonCount {
    scientific_name: String,
    kingdom: Option<String>,
    taxon_rank: Option<String>,
    count: usize,
    #[allow(dead_code)]
    agreement_count: usize,
}

/// Keep only each user's most recent identification
fn deduplicate_by_user(identifications: &[IdentificationRow]) -> Vec<&IdentificationRow> {
    let mut latest_by_user: std::collections::HashMap<&str, &IdentificationRow> =
        std::collections::HashMap::new();

    for id in identifications {
        let existing = latest_by_user.get(id.did.as_str());
        if existing.is_none() || id.date_identified > existing.unwrap().date_identified {
            latest_by_user.insert(&id.did, id);
        }
    }

    latest_by_user.into_values().collect()
}

/// Group identifications by scientific name + kingdom
fn group_by_taxon(identifications: &[&IdentificationRow]) -> Vec<TaxonCount> {
    let mut counts: std::collections::HashMap<String, TaxonCount> =
        std::collections::HashMap::new();

    for id in identifications {
        let kingdom = id.kingdom.as_deref().unwrap_or("").to_lowercase();
        let key = format!("{}|{}", id.scientific_name.to_lowercase(), kingdom);

        let entry = counts.entry(key).or_insert_with(|| TaxonCount {
            scientific_name: id.scientific_name.clone(),
            kingdom: id.kingdom.clone(),
            taxon_rank: id.taxon_rank.clone(),
            count: 0,
            agreement_count: 0,
        });
        entry.count += 1;
        if id.is_agreement.unwrap_or(false) {
            entry.agreement_count += 1;
        }
    }

    counts.into_values().collect()
}

/// Find the winning taxon (most votes; if ties, first sorted wins)
fn find_winner(taxon_counts: &[TaxonCount]) -> Option<&TaxonCount> {
    if taxon_counts.is_empty() {
        return None;
    }
    taxon_counts.iter().max_by_key(|t| t.count)
}

/// Quality grade for an occurrence
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QualityGrade {
    Research,
    NeedsId,
    Casual,
}

/// Determine quality grade from a community ID result
pub fn quality_grade(result: &Option<CommunityIdResult>) -> QualityGrade {
    match result {
        None => QualityGrade::Casual,
        Some(r) if r.is_research_grade => QualityGrade::Research,
        Some(_) => QualityGrade::NeedsId,
    }
}

/// Taxonomic rank ordering utilities
pub struct TaxonomicHierarchy;

impl TaxonomicHierarchy {
    const RANK_ORDER: &'static [&'static str] = &[
        "subspecies",
        "variety",
        "species",
        "genus",
        "family",
        "order",
        "class",
        "phylum",
        "kingdom",
    ];

    /// Get rank level (lower = more specific)
    pub fn rank_level(rank: &str) -> usize {
        Self::RANK_ORDER
            .iter()
            .position(|&r| r == rank.to_lowercase())
            .unwrap_or(0)
    }

    /// Check if rank1 is more specific than rank2
    pub fn is_more_specific(rank1: &str, rank2: &str) -> bool {
        Self::rank_level(rank1) < Self::rank_level(rank2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDateTime, TimeZone};

    fn make_id(
        did: &str,
        name: &str,
        kingdom: Option<&str>,
        is_agreement: bool,
        date: &str,
    ) -> IdentificationRow {
        IdentificationRow {
            uri: format!("at://{did}/org.rwell.test.identification/1"),
            cid: "cid".to_string(),
            did: did.to_string(),
            subject_uri: "at://did:plc:test/org.rwell.test.occurrence/1".to_string(),
            subject_cid: "cid".to_string(),
            subject_index: 0,
            scientific_name: name.to_string(),
            taxon_rank: Some("species".to_string()),
            identification_qualifier: None,
            taxon_id: None,
            identification_remarks: None,
            identification_verification_status: None,
            type_status: None,
            is_agreement: Some(is_agreement),
            date_identified: chrono::Utc.from_utc_datetime(
                &NaiveDateTime::parse_from_str(date, "%Y-%m-%d %H:%M:%S").unwrap(),
            ),
            vernacular_name: None,
            kingdom: kingdom.map(|s| s.to_string()),
            phylum: None,
            class: None,
            order_: None,
            family: None,
            genus: None,
            confidence: None,
        }
    }

    #[test]
    fn test_empty_identifications() {
        assert!(calculate(&[]).is_none());
    }

    #[test]
    fn test_single_identification() {
        let ids = vec![make_id(
            "user1",
            "Quercus alba",
            Some("Plantae"),
            false,
            "2024-01-01 12:00:00",
        )];
        let result = calculate(&ids).unwrap();
        assert_eq!(result.scientific_name, "Quercus alba");
        assert_eq!(result.identification_count, 1);
        assert!(!result.is_research_grade);
    }

    #[test]
    fn test_research_grade_consensus() {
        let ids = vec![
            make_id(
                "user1",
                "Quercus alba",
                Some("Plantae"),
                true,
                "2024-01-01 12:00:00",
            ),
            make_id(
                "user2",
                "Quercus alba",
                Some("Plantae"),
                true,
                "2024-01-02 12:00:00",
            ),
            make_id(
                "user3",
                "Quercus alba",
                Some("Plantae"),
                true,
                "2024-01-03 12:00:00",
            ),
        ];
        let result = calculate(&ids).unwrap();
        assert_eq!(result.scientific_name, "Quercus alba");
        assert_eq!(result.identification_count, 3);
        assert!(result.is_research_grade);
    }

    #[test]
    fn test_deduplication_by_user() {
        // user1 submits two IDs, only the latest should be kept
        let ids = vec![
            make_id(
                "user1",
                "Quercus rubra",
                Some("Plantae"),
                false,
                "2024-01-01 12:00:00",
            ),
            make_id(
                "user1",
                "Quercus alba",
                Some("Plantae"),
                false,
                "2024-01-02 12:00:00",
            ),
            make_id(
                "user2",
                "Quercus alba",
                Some("Plantae"),
                true,
                "2024-01-03 12:00:00",
            ),
        ];
        let result = calculate(&ids).unwrap();
        assert_eq!(result.scientific_name, "Quercus alba");
        assert_eq!(result.identification_count, 2);
    }

    #[test]
    fn test_no_threshold_still_returns_leader() {
        let ids = vec![
            make_id(
                "user1",
                "Quercus alba",
                Some("Plantae"),
                false,
                "2024-01-01 12:00:00",
            ),
            make_id(
                "user2",
                "Quercus rubra",
                Some("Plantae"),
                false,
                "2024-01-02 12:00:00",
            ),
            make_id(
                "user3",
                "Acer saccharum",
                Some("Plantae"),
                false,
                "2024-01-03 12:00:00",
            ),
        ];
        let result = calculate(&ids).unwrap();
        // No consensus, but should still return one of them
        assert_eq!(result.identification_count, 3);
        assert!(!result.is_research_grade);
    }

    #[test]
    fn test_quality_grade() {
        assert_eq!(quality_grade(&None), QualityGrade::Casual);

        let rg = Some(CommunityIdResult {
            scientific_name: "Test".to_string(),
            kingdom: None,
            taxon_rank: None,
            identification_count: 3,
            agreement_count: 3,
            confidence: 1.0,
            is_research_grade: true,
        });
        assert_eq!(quality_grade(&rg), QualityGrade::Research);

        let needs_id = Some(CommunityIdResult {
            scientific_name: "Test".to_string(),
            kingdom: None,
            taxon_rank: None,
            identification_count: 1,
            agreement_count: 1,
            confidence: 1.0,
            is_research_grade: false,
        });
        assert_eq!(quality_grade(&needs_id), QualityGrade::NeedsId);
    }

    #[test]
    fn test_taxonomic_hierarchy() {
        assert!(TaxonomicHierarchy::is_more_specific("species", "genus"));
        assert!(TaxonomicHierarchy::is_more_specific("genus", "family"));
        assert!(!TaxonomicHierarchy::is_more_specific("kingdom", "species"));
    }
}
