//! Fall back to a broader rank when the model can't pick a species.
//!
//! BioCLIP often sees that a photo is a bumble bee without being able to tell
//! which one: the probability is spread over a dozen *Bombus* species, none of
//! which is a confident answer, but together they are. This module turns the
//! similarity scores into a probability distribution, adds it up at each rank
//! from genus to kingdom, and reports the most specific taxon whose total
//! passes a threshold.
//!
//! Taxa are grouped by their whole lineage, not just their name, so homonyms
//! in different kingdoms (e.g. the plant and the bird genus *Prunella*) stay
//! apart. The grouping is built once at startup; each request then costs one
//! softmax and one pass over the probabilities per rank.

use crate::embeddings::SpeciesLabel;
use observing_species_id_protocol::{RankFallback, TaxonRank};
use std::collections::HashMap;
use tracing::{info, warn};

/// Probability a taxon needs before we'll name it, as the top species or as a
/// fallback. Override with `SPECIES_ROLLUP_THRESHOLD`.
///
/// It is a precision/specificity trade: if the probabilities are calibrated,
/// a fallback is right about this often, and raising it gives broader but
/// safer answers. 0.7 keeps "probably a *Bombus*" style answers at genus or
/// family for most photos where the species is a coin flip, without naming a
/// genus on a near-tie between two of them. See "Tuning the rank fallback" in
/// docs/deployment.md before changing it.
pub const DEFAULT_THRESHOLD: f32 = 0.7;

/// Multiplier applied to the cosine similarities before the softmax, i.e. the
/// inverse temperature. Override with `SPECIES_LOGIT_SCALE`.
///
/// CLIP-family models, BioCLIP included, learn this during training and clamp
/// it at 100, which is where trained models sit; it's what makes their zero-shot
/// probabilities roughly calibrated. A different export can be checked with
/// `model.logit_scale.exp()`. Lower values spread probability over more species
/// (more fallbacks); higher values concentrate it on the top few.
pub const DEFAULT_LOGIT_SCALE: f32 = 100.0;

/// Ranks to try after species, most specific first.
const RANKS: [TaxonRank; 6] = [
    TaxonRank::Genus,
    TaxonRank::Family,
    TaxonRank::Order,
    TaxonRank::Class,
    TaxonRank::Phylum,
    TaxonRank::Kingdom,
];

/// Ranks from the top down, the order a lineage is read in.
const LINEAGE: [TaxonRank; 6] = [
    TaxonRank::Kingdom,
    TaxonRank::Phylum,
    TaxonRank::Class,
    TaxonRank::Order,
    TaxonRank::Family,
    TaxonRank::Genus,
];

/// Marks a species with no value at a rank; its probability isn't counted
/// toward any taxon at that rank.
const NO_TAXON: u32 = u32::MAX;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RollupConfig {
    pub logit_scale: f32,
    pub threshold: f32,
}

impl Default for RollupConfig {
    fn default() -> Self {
        Self {
            logit_scale: DEFAULT_LOGIT_SCALE,
            threshold: DEFAULT_THRESHOLD,
        }
    }
}

impl RollupConfig {
    /// Read `SPECIES_LOGIT_SCALE` and `SPECIES_ROLLUP_THRESHOLD`, keeping the
    /// default for any that are unset or out of range.
    pub fn from_env() -> Self {
        let config = Self::from_vars(|name| std::env::var(name).ok());
        info!(
            logit_scale = config.logit_scale,
            threshold = config.threshold,
            "Rank fallback configured"
        );
        config
    }

    fn from_vars(var: impl Fn(&str) -> Option<String>) -> Self {
        let defaults = Self::default();
        let read = |name: &str, default: f32, valid: fn(f32) -> bool| {
            let Some(raw) = var(name) else {
                return default;
            };
            match raw.trim().parse::<f32>() {
                Ok(value) if valid(value) => value,
                _ => {
                    warn!(name, value = %raw, default, "Ignoring invalid setting");
                    default
                }
            }
        };
        Self {
            logit_scale: read("SPECIES_LOGIT_SCALE", defaults.logit_scale, |v| {
                v.is_finite() && v > 0.0
            }),
            threshold: read("SPECIES_ROLLUP_THRESHOLD", defaults.threshold, |v| {
                v > 0.0 && v <= 1.0
            }),
        }
    }
}

/// The taxa at one rank and which of them each species belongs to.
struct RankTaxa {
    /// Index into `taxa` for each species, or [`NO_TAXON`].
    species_taxon: Vec<u32>,
    /// Each taxon at this rank, ready to return with its `confidence` filled in.
    taxa: Vec<RankFallback>,
}

impl RankTaxa {
    fn build(labels: &[SpeciesLabel], rank: TaxonRank) -> Self {
        let depth = LINEAGE.iter().position(|&r| r == rank).unwrap_or(0);
        let mut ids: HashMap<Vec<Option<&str>>, u32> = HashMap::new();
        let mut taxa = Vec::new();
        let species_taxon = labels
            .iter()
            .map(|label| {
                let Some(name) = rank_value(label, rank) else {
                    return NO_TAXON;
                };
                let lineage = LINEAGE[..=depth]
                    .iter()
                    .map(|&r| rank_value(label, r))
                    .collect();
                *ids.entry(lineage).or_insert_with(|| {
                    let above = |r: TaxonRank| {
                        let is_above = LINEAGE[..depth].contains(&r);
                        is_above
                            .then(|| rank_value(label, r).map(String::from))
                            .flatten()
                    };
                    taxa.push(RankFallback {
                        rank,
                        scientific_name: name.to_string(),
                        confidence: 0.0,
                        kingdom: above(TaxonRank::Kingdom),
                        phylum: above(TaxonRank::Phylum),
                        class: above(TaxonRank::Class),
                        order: above(TaxonRank::Order),
                        family: above(TaxonRank::Family),
                    });
                    (taxa.len() - 1) as u32
                })
            })
            .collect();
        Self {
            species_taxon,
            taxa,
        }
    }
}

fn rank_value(label: &SpeciesLabel, rank: TaxonRank) -> Option<&str> {
    let value = match rank {
        TaxonRank::Kingdom => &label.kingdom,
        TaxonRank::Phylum => &label.phylum,
        TaxonRank::Class => &label.class,
        TaxonRank::Order => &label.order,
        TaxonRank::Family => &label.family,
        TaxonRank::Genus => &label.genus,
    };
    value.as_deref().filter(|v| !v.is_empty())
}

/// Picks a broader answer when no species is confident.
pub struct TaxonRollup {
    config: RollupConfig,
    /// Most specific rank first, in [`RANKS`] order.
    ranks: Vec<RankTaxa>,
}

impl TaxonRollup {
    pub fn new(labels: &[SpeciesLabel], config: RollupConfig) -> Self {
        let ranks = RANKS
            .iter()
            .map(|&rank| RankTaxa::build(labels, rank))
            .collect();
        Self { config, ranks }
    }

    /// The most specific taxon above species whose probability passes the
    /// threshold, given every species' score (cosine similarity plus any geo
    /// boost, in label order). `None` when the top species passes on its own,
    /// or when not even a kingdom does.
    pub fn fallback(&self, scores: &[f32]) -> Option<RankFallback> {
        self.fallback_from_probs(&softmax(scores, self.config.logit_scale))
    }

    fn fallback_from_probs(&self, probs: &[f32]) -> Option<RankFallback> {
        let threshold = self.config.threshold;
        if probs.iter().any(|&p| p >= threshold) {
            return None;
        }
        // A taxon's total is at least that of any taxon inside it, so the
        // first rank with a taxon over the threshold is the most specific one.
        let mut totals = Vec::new();
        for rank in &self.ranks {
            totals.clear();
            totals.resize(rank.taxa.len(), 0.0f32);
            for (&taxon, &p) in rank.species_taxon.iter().zip(probs) {
                if taxon != NO_TAXON {
                    totals[taxon as usize] += p;
                }
            }
            let best = totals.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1));
            if let Some((taxon, &total)) = best {
                if total >= threshold {
                    return Some(RankFallback {
                        confidence: total,
                        ..rank.taxa[taxon].clone()
                    });
                }
            }
        }
        None
    }
}

/// Softmax of `scores * scale`, summing in f64 so a long tail of tiny
/// probabilities over a few hundred thousand species doesn't lose precision.
fn softmax(scores: &[f32], scale: f32) -> Vec<f32> {
    let max = scores.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    if !max.is_finite() {
        return vec![0.0; scores.len()];
    }
    let exps: Vec<f64> = scores
        .iter()
        .map(|&s| (f64::from(s - max) * f64::from(scale)).exp())
        .collect();
    let sum: f64 = exps.iter().sum();
    exps.into_iter().map(|e| (e / sum) as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(lineage: [&str; 6], species: &str) -> SpeciesLabel {
        let rank = |i: usize| Some(lineage[i].to_string()).filter(|s| !s.is_empty());
        SpeciesLabel {
            scientific_name: species.to_string(),
            common_name: None,
            kingdom: rank(0),
            phylum: rank(1),
            class: rank(2),
            order: rank(3),
            family: rank(4),
            genus: rank(5),
        }
    }

    const BEE: [&str; 5] = ["Animalia", "Arthropoda", "Insecta", "Hymenoptera", "Apidae"];

    fn bee(genus: &str, species: &str) -> SpeciesLabel {
        label(
            [BEE[0], BEE[1], BEE[2], BEE[3], BEE[4], genus],
            &format!("{genus} {species}"),
        )
    }

    /// Three bumble bees, two carpenter bees, a wasp and a plant.
    fn labels() -> Vec<SpeciesLabel> {
        vec![
            bee("Bombus", "impatiens"),
            bee("Bombus", "griseocollis"),
            bee("Bombus", "bimaculatus"),
            bee("Xylocopa", "virginica"),
            bee("Xylocopa", "micans"),
            label(
                [BEE[0], BEE[1], BEE[2], BEE[3], "Vespidae", "Vespula"],
                "Vespula maculifrons",
            ),
            label(
                [
                    "Plantae",
                    "Tracheophyta",
                    "Magnoliopsida",
                    "Lamiales",
                    "Lamiaceae",
                    "Prunella",
                ],
                "Prunella vulgaris",
            ),
        ]
    }

    fn rollup(threshold: f32) -> TaxonRollup {
        TaxonRollup::new(
            &labels(),
            RollupConfig {
                threshold,
                ..RollupConfig::default()
            },
        )
    }

    #[test]
    fn softmax_sums_to_one_and_keeps_order() {
        let probs = softmax(&[0.30, 0.29, 0.10], 100.0);
        let sum: f32 = probs.iter().sum();
        assert!((sum - 1.0).abs() < 1e-6, "sum = {sum}");
        assert!(probs[0] > probs[1] && probs[1] > probs[2]);
        // A 0.01 cosine gap at scale 100 is one logit: e times more likely.
        assert!((probs[0] / probs[1] - std::f32::consts::E).abs() < 1e-3);
    }

    #[test]
    fn softmax_is_stable_for_large_scales() {
        let probs = softmax(&[0.9, 0.1], 1e4);
        assert_eq!(probs, vec![1.0, 0.0]);
    }

    #[test]
    fn confident_species_needs_no_fallback() {
        let probs = [0.9, 0.05, 0.05, 0.0, 0.0, 0.0, 0.0];
        assert_eq!(rollup(0.7).fallback_from_probs(&probs), None);
    }

    #[test]
    fn split_between_congeners_falls_back_to_genus() {
        let probs = [0.4, 0.3, 0.1, 0.1, 0.05, 0.05, 0.0];
        let fallback = rollup(0.7).fallback_from_probs(&probs).unwrap();
        assert_eq!(fallback.rank, TaxonRank::Genus);
        assert_eq!(fallback.scientific_name, "Bombus");
        assert!((fallback.confidence - 0.8).abs() < 1e-6);
        assert_eq!(fallback.kingdom.as_deref(), Some("Animalia"));
        assert_eq!(fallback.family.as_deref(), Some("Apidae"));
    }

    #[test]
    fn split_between_genera_falls_back_to_family() {
        let probs = [0.25, 0.1, 0.05, 0.3, 0.1, 0.1, 0.1];
        let fallback = rollup(0.7).fallback_from_probs(&probs).unwrap();
        assert_eq!(fallback.rank, TaxonRank::Family);
        assert_eq!(fallback.scientific_name, "Apidae");
        assert!((fallback.confidence - 0.8).abs() < 1e-6);
        // Only ancestors are set, never the fallback's own rank.
        assert_eq!(fallback.order.as_deref(), Some("Hymenoptera"));
        assert_eq!(fallback.family, None);
    }

    #[test]
    fn falls_back_past_families_to_order() {
        let probs = [0.2, 0.1, 0.1, 0.1, 0.1, 0.3, 0.1];
        let fallback = rollup(0.7).fallback_from_probs(&probs).unwrap();
        assert_eq!(fallback.rank, TaxonRank::Order);
        assert_eq!(fallback.scientific_name, "Hymenoptera");
        assert!((fallback.confidence - 0.9).abs() < 1e-6);
    }

    #[test]
    fn nothing_when_no_rank_passes() {
        let probs = [0.15, 0.15, 0.1, 0.1, 0.1, 0.0, 0.4];
        assert_eq!(rollup(0.7).fallback_from_probs(&probs), None);
    }

    #[test]
    fn threshold_moves_the_answer() {
        let probs = [0.4, 0.3, 0.1, 0.1, 0.05, 0.05, 0.0];
        let genus = rollup(0.75).fallback_from_probs(&probs).unwrap();
        assert_eq!(genus.rank, TaxonRank::Genus);
        let family = rollup(0.85).fallback_from_probs(&probs).unwrap();
        assert_eq!(family.rank, TaxonRank::Family);
        assert_eq!(rollup(0.35).fallback_from_probs(&probs), None);
    }

    #[test]
    fn homonyms_in_different_lineages_stay_apart() {
        let labels = vec![
            label(
                [
                    "Plantae",
                    "Tracheophyta",
                    "Magnoliopsida",
                    "Lamiales",
                    "Lamiaceae",
                    "Prunella",
                ],
                "Prunella vulgaris",
            ),
            label(
                [
                    "Animalia",
                    "Chordata",
                    "Aves",
                    "Passeriformes",
                    "Prunellidae",
                    "Prunella",
                ],
                "Prunella modularis",
            ),
        ];
        let rollup = TaxonRollup::new(&labels, RollupConfig::default());
        // Summed by name alone, "Prunella" would get all of it.
        assert_eq!(rollup.fallback_from_probs(&[0.5, 0.5]), None);
    }

    #[test]
    fn species_missing_a_rank_skip_it() {
        let mut labels = labels();
        labels[0].genus = None;
        let rollup = TaxonRollup::new(&labels, RollupConfig::default());
        // Bombus now only gets 0.4; Apidae still counts the unplaced bee.
        let probs = [0.4, 0.3, 0.1, 0.1, 0.05, 0.05, 0.0];
        let fallback = rollup.fallback_from_probs(&probs).unwrap();
        assert_eq!(fallback.rank, TaxonRank::Family);
        assert!((fallback.confidence - 0.95).abs() < 1e-6);
    }

    #[test]
    fn fallback_from_scores_uses_the_logit_scale() {
        // Three bumble bees a hair apart and everything else far behind.
        let scores = [0.300, 0.298, 0.296, 0.20, 0.20, 0.20, 0.10];
        let fallback = rollup(0.9).fallback(&scores).unwrap();
        assert_eq!(fallback.scientific_name, "Bombus");
        assert!(fallback.confidence > 0.99);
        // At a tenth of the scale the same scores are nearly flat.
        let flat = TaxonRollup::new(
            &labels(),
            RollupConfig {
                logit_scale: 10.0,
                threshold: 0.9,
            },
        );
        assert_eq!(flat.fallback(&scores).unwrap().rank, TaxonRank::Order);
    }

    #[test]
    fn config_reads_env_and_rejects_bad_values() {
        let vars = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(k, _)| *k == name)
                    .map(|(_, v)| v.to_string())
            }
        };
        assert_eq!(RollupConfig::from_vars(vars(&[])), RollupConfig::default());
        assert_eq!(
            RollupConfig::from_vars(vars(&[
                ("SPECIES_ROLLUP_THRESHOLD", "0.9"),
                ("SPECIES_LOGIT_SCALE", " 50 "),
            ])),
            RollupConfig {
                logit_scale: 50.0,
                threshold: 0.9
            }
        );
        for bad in ["0", "1.5", "-0.2", "NaN", "high"] {
            let config = RollupConfig::from_vars(move |name: &str| {
                (name == "SPECIES_ROLLUP_THRESHOLD").then(|| bad.to_string())
            });
            assert_eq!(config.threshold, DEFAULT_THRESHOLD, "threshold {bad}");
        }
        let config = RollupConfig::from_vars(|name: &str| {
            (name == "SPECIES_LOGIT_SCALE").then(|| "inf".to_string())
        });
        assert_eq!(config.logit_scale, DEFAULT_LOGIT_SCALE);
    }
}
