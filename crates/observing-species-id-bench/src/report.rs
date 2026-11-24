//! Turn one or more results files into a Markdown report.
//!
//! Scoring, per sample:
//! * species top-1 / top-5: the first one / five suggestions include the
//!   accepted species (binomials compared case-insensitively, so a
//!   subspecies ID scores against its species). Only samples whose accepted
//!   taxon is at species rank or below count.
//! * genus top-1 / family top-1: the first suggestion's genus / family is the
//!   accepted taxon's. Samples identified only to family count for family.
//!
//! * fallback (builds that return one): the broader taxon is right when the
//!   accepted taxon's ancestor at that rank has the same name.
//!
//! A request that failed counts as a miss. Every rate carries its Wilson 95%
//! interval: with a few hundred samples, differences of a few points are noise.

use crate::names;
use crate::run::{Fallback, RunFile, SampleResult};
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scores {
    pub species_top1: Option<bool>,
    pub species_top5: Option<bool>,
    pub genus_top1: Option<bool>,
    pub family_top1: Option<bool>,
}

pub fn score(sample: &SampleResult) -> Scores {
    let truth = &sample.taxon;
    let ok = sample.error.is_none();
    let top = sample.suggestions.first();
    let species_in = |k: usize| {
        truth.species.as_ref().map(|species| {
            ok && sample
                .suggestions
                .iter()
                .take(k)
                .any(|s| names::binomial(&s.scientific_name).as_ref() == Some(species))
        })
    };
    let top_genus = top.and_then(|s| {
        s.genus.clone().or_else(|| {
            s.scientific_name
                .split_whitespace()
                .next()
                .map(str::to_string)
        })
    });
    Scores {
        species_top1: species_in(1),
        species_top5: species_in(5),
        genus_top1: truth
            .genus
            .as_deref()
            .map(|g| ok && names::same(top_genus.as_deref(), Some(g))),
        family_top1: truth
            .family
            .as_deref()
            .map(|f| ok && names::same(top.and_then(|s| s.family.as_deref()), Some(f))),
    }
}

#[derive(Debug, Default, Clone, Copy)]
struct Rate {
    hits: usize,
    n: usize,
}

impl Rate {
    fn add(&mut self, outcome: Option<bool>) {
        if let Some(hit) = outcome {
            self.n += 1;
            self.hits += usize::from(hit);
        }
    }

    fn value(&self) -> Option<f64> {
        (self.n > 0).then(|| self.hits as f64 / self.n as f64)
    }

    fn cell(&self) -> String {
        match self.value() {
            None => "–".to_string(),
            Some(p) => {
                let (lo, hi) = wilson(self.hits, self.n);
                format!(
                    "{:.1}% ({}/{}, {:.0}–{:.0})",
                    p * 100.0,
                    self.hits,
                    self.n,
                    lo * 100.0,
                    hi * 100.0
                )
            }
        }
    }
}

/// Wilson score interval at 95%.
fn wilson(hits: usize, n: usize) -> (f64, f64) {
    if n == 0 {
        return (0.0, 0.0);
    }
    let z = 1.96_f64;
    let n_f = n as f64;
    let p = hits as f64 / n_f;
    let denom = 1.0 + z * z / n_f;
    let center = (p + z * z / (2.0 * n_f)) / denom;
    let margin = z * ((p * (1.0 - p) / n_f + z * z / (4.0 * n_f * n_f)).sqrt()) / denom;
    ((center - margin).max(0.0), (center + margin).min(1.0))
}

#[derive(Debug, Default, Clone, Copy)]
struct Tally {
    samples: usize,
    species_top1: Rate,
    species_top5: Rate,
    genus_top1: Rate,
    family_top1: Rate,
}

impl Tally {
    fn add(&mut self, s: Scores) {
        self.samples += 1;
        self.species_top1.add(s.species_top1);
        self.species_top5.add(s.species_top5);
        self.genus_top1.add(s.genus_top1);
        self.family_top1.add(s.family_top1);
    }

    fn of<'a>(samples: impl IntoIterator<Item = &'a SampleResult>) -> Self {
        let mut t = Tally::default();
        for s in samples {
            t.add(score(s));
        }
        t
    }
}

/// Nearest-rank percentile of an unsorted slice.
fn percentile(values: &[f64], pct: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = ((pct / 100.0) * sorted.len() as f64).ceil() as usize;
    Some(sorted[rank.clamp(1, sorted.len()) - 1])
}

/// Whether a fallback taxon contains the accepted taxon; `None` when the
/// accepted taxon doesn't reach that rank (e.g. a family-level ID against a
/// genus fallback).
pub fn fallback_correct(fallback: &Fallback, sample: &SampleResult) -> Option<bool> {
    let t = &sample.taxon;
    let ancestor = match fallback.rank.to_lowercase().as_str() {
        "kingdom" => t.kingdom.as_deref(),
        "phylum" => t.phylum.as_deref(),
        "class" => t.class.as_deref(),
        "order" => t.order.as_deref(),
        "family" => t.family.as_deref(),
        "genus" => t.genus.as_deref(),
        _ => None,
    }?;
    Some(names::same(Some(ancestor), Some(&fallback.scientific_name)))
}

/// How often each run fell back to a broader rank, and how often that was right.
fn fallbacks(out: &mut String, runs: &[RunFile]) {
    out.push_str(
        "\n## Rank fallback\n\nRight: the accepted taxon falls inside the fallback taxon. \
         The species top-1 columns show whether fallbacks land on the photos the model gets wrong.\n\n\
         | run | fallbacks | right | species top-1 with a fallback | species top-1 without | ranks |\n\
         |---|--:|--:|--:|--:|---|\n",
    );
    for run in runs {
        let ok: Vec<&SampleResult> = run.samples.iter().filter(|s| s.error.is_none()).collect();
        let mut right = Rate::default();
        let mut with = Rate::default();
        let mut without = Rate::default();
        let mut ranks: BTreeMap<String, usize> = BTreeMap::new();
        let mut count = 0;
        for s in &ok {
            let species = score(s).species_top1;
            match &s.fallback {
                Some(f) => {
                    count += 1;
                    *ranks.entry(f.rank.to_lowercase()).or_default() += 1;
                    right.add(fallback_correct(f, s));
                    with.add(species);
                }
                None => without.add(species),
            }
        }
        let ranks = ranks
            .iter()
            .map(|(rank, n)| format!("{rank} {n}"))
            .collect::<Vec<_>>()
            .join(", ");
        let _ = writeln!(
            out,
            "| {} | {} of {} | {} | {} | {} | {} |",
            run.name,
            count,
            ok.len(),
            right.cell(),
            with.cell(),
            without.cell(),
            if ranks.is_empty() {
                "–".to_string()
            } else {
                ranks
            },
        );
    }
}

fn ms(v: Option<f64>) -> String {
    v.map_or("–".to_string(), |v| format!("{v:.0} ms"))
}

const ACCURACY_HEADER: &str =
    "| {group} | run | samples | species top-1 | species top-5 | genus top-1 | family top-1 |\n|---|---|--:|--:|--:|--:|--:|\n";

fn accuracy_row(out: &mut String, group: &str, run: &str, t: &Tally) {
    let _ = writeln!(
        out,
        "| {group} | {run} | {} | {} | {} | {} | {} |",
        t.samples,
        t.species_top1.cell(),
        t.species_top5.cell(),
        t.genus_top1.cell(),
        t.family_top1.cell(),
    );
}

/// Rows grouped by `key`, largest group first, each followed by every run.
fn breakdown(out: &mut String, title: &str, runs: &[RunFile], key: fn(&SampleResult) -> String) {
    let mut sizes: BTreeMap<String, usize> = BTreeMap::new();
    for s in &runs[0].samples {
        *sizes.entry(key(s)).or_default() += 1;
    }
    let mut groups: Vec<(String, usize)> = sizes.into_iter().collect();
    groups.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let _ = writeln!(out, "\n## By {}\n", title.to_lowercase());
    out.push_str(&ACCURACY_HEADER.replace("{group}", title));
    for (group, _) in groups {
        for run in runs {
            let tally = Tally::of(run.samples.iter().filter(|s| key(s) == group));
            accuracy_row(out, &group, &run.name, &tally);
        }
    }
}

pub fn render(runs: &[RunFile]) -> String {
    let mut out = String::new();
    if runs.is_empty() {
        return out;
    }
    let ds = &runs[0].dataset;
    let _ = writeln!(out, "# Species-ID benchmark\n");
    let _ = writeln!(
        out,
        "Dataset `{}`: {} samples from `{}`, fingerprint `{}`.\n",
        ds.path,
        ds.sample_count,
        ds.source,
        &ds.fingerprint[..ds.fingerprint.len().min(12)]
    );
    if runs.iter().any(|r| r.dataset.fingerprint != ds.fingerprint) {
        out.push_str(
            "> **Warning:** these runs scored different datasets (fingerprints differ). \
             The comparison below uses only the samples they share.\n\n",
        );
    }

    out.push_str(
        "| run | endpoint | model | species | requests | errors | location | crop | limit |\n\
         |---|---|---|--:|--:|--:|---|---|--:|\n",
    );
    for r in runs {
        let errors = r.samples.iter().filter(|s| s.error.is_some()).count();
        let crops = r.samples.iter().filter(|s| s.sent_crop).count();
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            r.name,
            r.endpoint,
            r.model_version.as_deref().unwrap_or("?"),
            r.species_count.map_or("?".to_string(), |n| n.to_string()),
            r.samples.len(),
            errors,
            if r.settings.location { "yes" } else { "no" },
            if r.settings.crop {
                format!("{crops} cropped")
            } else {
                "off".to_string()
            },
            r.settings.limit,
        );
    }
    if runs.iter().any(|r| r.settings.limit < 5) {
        out.push_str("\nTop-5 counts only as many suggestions as each run asked for (`limit`).\n");
    }

    out.push_str("\n## Accuracy\n\nCells: rate (hits/scored, Wilson 95% interval).\n\n");
    out.push_str(&ACCURACY_HEADER.replace("{group}", "kingdom"));
    for run in runs {
        accuracy_row(&mut out, "all", &run.name, &Tally::of(&run.samples));
    }

    if runs.len() > 1 {
        changes(&mut out, runs);
    }

    breakdown(&mut out, "Kingdom", runs, |s| {
        s.taxon.kingdom.clone().unwrap_or_else(|| "unknown".into())
    });
    breakdown(&mut out, "Organisms", runs, |s| s.organisms.clone());
    breakdown(&mut out, "Rank", runs, |s| s.taxon.rank.clone());

    if runs
        .iter()
        .any(|r| r.samples.iter().any(|s| s.fallback.is_some()))
    {
        fallbacks(&mut out, runs);
    }

    out.push_str(
        "\n## Latency\n\nWall: the whole request as the client saw it. Server: the service's own `inferenceTimeMs`. Failed requests are left out.\n\n\
         | run | wall p50 | wall p90 | wall p99 | wall max | server p50 | server p90 | server p99 |\n\
         |---|--:|--:|--:|--:|--:|--:|--:|\n",
    );
    for r in runs {
        let ok: Vec<&SampleResult> = r.samples.iter().filter(|s| s.error.is_none()).collect();
        let wall: Vec<f64> = ok.iter().map(|s| s.latency_ms).collect();
        let server: Vec<f64> = ok
            .iter()
            .filter_map(|s| s.inference_ms.map(|v| v as f64))
            .collect();
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} | {} | {} | {} |",
            r.name,
            ms(percentile(&wall, 50.0)),
            ms(percentile(&wall, 90.0)),
            ms(percentile(&wall, 99.0)),
            ms(percentile(&wall, 100.0)),
            ms(percentile(&server, 50.0)),
            ms(percentile(&server, 90.0)),
            ms(percentile(&server, 99.0)),
        );
    }
    out
}

/// Each later run against the first, on the samples both scored.
fn changes(out: &mut String, runs: &[RunFile]) {
    let base = &runs[0];
    let base_by_id: HashMap<&str, &SampleResult> =
        base.samples.iter().map(|s| (s.id.as_str(), s)).collect();

    let _ = writeln!(
        out,
        "\n## Changes against `{}`\n\nOn the samples both runs answered: a sample where either request failed is left out and counted under \"failed\", so outages don't read as regressions. Fixed: the baseline missed and this run hit; broke: the reverse.\n",
        base.name
    );
    out.push_str(
        "| run | shared | failed | species top-1 Δ | species top-5 Δ | genus top-1 Δ | family top-1 Δ | species top-1 fixed / broke | genus top-1 fixed / broke |\n\
         |---|--:|--:|--:|--:|--:|--:|--:|--:|\n",
    );
    let mut examples = String::new();
    for run in &runs[1..] {
        let pairs: Vec<(&SampleResult, &SampleResult)> = run
            .samples
            .iter()
            .filter_map(|s| base_by_id.get(s.id.as_str()).map(|b| (*b, s)))
            .collect();
        let failed = pairs
            .iter()
            .filter(|(b, a)| b.error.is_some() || a.error.is_some())
            .count();
        let pairs: Vec<_> = pairs
            .into_iter()
            .filter(|(b, a)| b.error.is_none() && a.error.is_none())
            .collect();
        let before = Tally::of(pairs.iter().map(|(b, _)| *b));
        let after = Tally::of(pairs.iter().map(|(_, a)| *a));
        let delta = |b: Rate, a: Rate| match (b.value(), a.value()) {
            (Some(b), Some(a)) => format!("{:+.1} pp", (a - b) * 100.0),
            _ => "–".to_string(),
        };
        let mut species = (0, 0);
        let mut genus = (0, 0);
        let mut fixed_examples = Vec::new();
        let mut broke_examples = Vec::new();
        for (b, a) in &pairs {
            let (sb, sa) = (score(b), score(a));
            match (sb.species_top1, sa.species_top1) {
                (Some(false), Some(true)) => {
                    species.0 += 1;
                    fixed_examples.push(example(b, a));
                }
                (Some(true), Some(false)) => {
                    species.1 += 1;
                    broke_examples.push(example(b, a));
                }
                _ => {}
            }
            match (sb.genus_top1, sa.genus_top1) {
                (Some(false), Some(true)) => genus.0 += 1,
                (Some(true), Some(false)) => genus.1 += 1,
                _ => {}
            }
        }
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} | {} | {} | {} / {} | {} / {} |",
            run.name,
            pairs.len(),
            failed,
            delta(before.species_top1, after.species_top1),
            delta(before.species_top5, after.species_top5),
            delta(before.genus_top1, after.genus_top1),
            delta(before.family_top1, after.family_top1),
            species.0,
            species.1,
            genus.0,
            genus.1,
        );
        for (label, list) in [("fixed", fixed_examples), ("broke", broke_examples)] {
            if list.is_empty() {
                continue;
            }
            let _ = writeln!(
                examples,
                "\n<details><summary>{}: species top-1 {label} ({})</summary>\n\n| sample | accepted | {} top-1 | {} top-1 |\n|---|---|---|---|",
                run.name,
                list.len(),
                base.name,
                run.name
            );
            for line in list.iter().take(25) {
                examples.push_str(line);
            }
            examples.push_str("\n</details>\n");
        }
    }
    out.push_str(&examples);
}

fn example(before: &SampleResult, after: &SampleResult) -> String {
    let top = |s: &SampleResult| {
        s.error.as_ref().map_or_else(
            || {
                s.suggestions
                    .first()
                    .map_or("(none)".to_string(), |x| format!("*{}*", x.scientific_name))
            },
            |_| "(error)".to_string(),
        )
    };
    format!(
        "| `{}` | *{}* | {} | {} |\n",
        before.id,
        before.taxon.scientific_name,
        top(before),
        top(after)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dataset::Taxon;
    use observing_species_id_protocol::SpeciesSuggestion;

    fn taxon(name: &str, rank: &str) -> Taxon {
        let genus = name.split_whitespace().next().map(str::to_string);
        Taxon {
            scientific_name: name.into(),
            rank: rank.into(),
            kingdom: Some("Plantae".into()),
            phylum: None,
            class: None,
            order: None,
            family: Some("Fagaceae".into()),
            genus: (rank != "family").then_some(genus).flatten(),
            species: names::is_species_or_below(rank)
                .then(|| names::binomial(name))
                .flatten(),
            taxon_key: None,
        }
    }

    fn suggestion(name: &str, family: &str) -> SpeciesSuggestion {
        SpeciesSuggestion {
            scientific_name: name.into(),
            confidence: 0.5,
            common_name: None,
            kingdom: Some("Plantae".into()),
            phylum: None,
            class: None,
            order: None,
            family: Some(family.into()),
            genus: name.split_whitespace().next().map(str::to_string),
            in_range: None,
        }
    }

    fn result(truth: Taxon, suggestions: Vec<SpeciesSuggestion>) -> SampleResult {
        SampleResult {
            id: "x".into(),
            taxon: truth,
            organisms: "not reviewed".into(),
            sent_location: false,
            sent_crop: false,
            latency_ms: 1.0,
            inference_ms: Some(1),
            error: None,
            suggestions,
            fallback: None,
        }
    }

    #[test]
    fn scores_species_genus_family() {
        let r = result(
            taxon("Quercus agrifolia", "species"),
            vec![
                suggestion("Quercus wislizeni", "Fagaceae"),
                suggestion("Quercus agrifolia", "Fagaceae"),
            ],
        );
        assert_eq!(
            score(&r),
            Scores {
                species_top1: Some(false),
                species_top5: Some(true),
                genus_top1: Some(true),
                family_top1: Some(true),
            }
        );
    }

    #[test]
    fn subspecies_scores_against_its_species() {
        let r = result(
            taxon("Quercus agrifolia oxyadenia", "variety"),
            vec![suggestion("Quercus agrifolia", "Fagaceae")],
        );
        assert_eq!(score(&r).species_top1, Some(true));
    }

    #[test]
    fn genus_rank_truth_skips_species() {
        let r = result(
            taxon("Quercus", "genus"),
            vec![suggestion("Quercus agrifolia", "Fagaceae")],
        );
        let s = score(&r);
        assert_eq!(s.species_top1, None);
        assert_eq!(s.genus_top1, Some(true));
    }

    #[test]
    fn errors_are_misses() {
        let mut r = result(taxon("Quercus agrifolia", "species"), vec![]);
        r.error = Some("HTTP 500".into());
        let s = score(&r);
        assert_eq!(s.species_top1, Some(false));
        assert_eq!(s.family_top1, Some(false));
    }

    #[test]
    fn fallback_scored_against_ancestor() {
        let mut r = result(taxon("Quercus agrifolia", "species"), vec![]);
        let fallback = |rank: &str, name: &str| Fallback {
            rank: rank.into(),
            scientific_name: name.into(),
            confidence: Some(0.8),
        };
        assert_eq!(
            fallback_correct(&fallback("genus", "Quercus"), &r),
            Some(true)
        );
        assert_eq!(
            fallback_correct(&fallback("genus", "Lithocarpus"), &r),
            Some(false)
        );
        assert_eq!(
            fallback_correct(&fallback("family", "Fagaceae"), &r),
            Some(true)
        );
        // The ground truth has no order here, so an order fallback can't be judged.
        assert_eq!(fallback_correct(&fallback("order", "Fagales"), &r), None);
        r.taxon = taxon("Fagaceae", "family");
        assert_eq!(fallback_correct(&fallback("genus", "Quercus"), &r), None);
    }

    fn run_file(name: &str, samples: Vec<SampleResult>) -> RunFile {
        use crate::run::{DatasetRef, RunSettings};
        RunFile {
            format_version: 1,
            name: name.into(),
            endpoint: "http://localhost".into(),
            started_at: String::new(),
            finished_at: String::new(),
            model_version: None,
            species_count: None,
            settings: RunSettings {
                limit: 5,
                concurrency: 1,
                location: true,
                crop: true,
                warmup: 0,
            },
            dataset: DatasetRef {
                path: "ds".into(),
                source: "test".into(),
                fingerprint: "f".into(),
                sample_count: samples.len(),
            },
            samples,
        }
    }

    #[test]
    fn failed_requests_are_not_regressions() {
        let hit = || {
            result(
                taxon("Quercus agrifolia", "species"),
                vec![suggestion("Quercus agrifolia", "Fagaceae")],
            )
        };
        let mut failed = hit();
        failed.error = Some("connection refused".into());
        failed.suggestions.clear();
        let mut other = hit();
        other.id = "y".into();
        let base = run_file("a", vec![hit(), other.clone()]);
        let next = run_file("b", vec![failed, other]);
        let report = render(&[base, next]);
        // 1 shared sample, 1 failed, nothing fixed or broken.
        assert!(report.contains("| b | 1 | 1 | +0.0 pp |"), "{report}");
        assert!(report.contains("| 0 / 0 | 0 / 0 |"), "{report}");
    }

    #[test]
    fn percentiles_use_nearest_rank() {
        let v: Vec<f64> = (1..=100).map(f64::from).collect();
        assert_eq!(percentile(&v, 50.0), Some(50.0));
        assert_eq!(percentile(&v, 99.0), Some(99.0));
        assert_eq!(percentile(&v, 100.0), Some(100.0));
        assert_eq!(percentile(&[], 50.0), None);
    }

    #[test]
    fn wilson_interval_brackets_rate() {
        let (lo, hi) = wilson(50, 100);
        assert!(lo < 0.5 && hi > 0.5);
        assert!((lo - 0.404).abs() < 0.01 && (hi - 0.596).abs() < 0.01);
    }
}
