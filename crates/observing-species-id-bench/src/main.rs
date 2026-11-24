//! Offline accuracy benchmark for the observing-species-id service.
//!
//! ```text
//! species-id-bench export   draw a seeded ground-truth set from observations
//!                           whose community ID has reached agreement
//! species-id-bench flag     mark photos as multi-organism, crop or exclude them
//! species-id-bench run      score one or more /identify endpoints on the set
//! species-id-bench report   re-render (and compare) saved results files
//! ```
//!
//! See docs/species-id-benchmark.md.

mod dataset;
mod export;
mod names;
mod report;
mod run;

use anyhow::{bail, Result};
use clap::{Args, Parser, Subcommand};
use dataset::{Annotation, Crop};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "species-id-bench",
    about = "Offline accuracy benchmark for species-id"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Draw a seeded ground-truth dataset of agreed-upon observations.
    Export(ExportArgs),
    /// Flag samples: several organisms in frame, a crop to one, or exclude.
    Flag(FlagArgs),
    /// Post every sample to one or more /identify endpoints and report.
    Run(RunArgs),
    /// Render a report from saved results files; several compare side by side.
    Report(ReportArgs),
}

#[derive(Args)]
struct ExportArgs {
    /// Directory to write the dataset to.
    #[arg(long)]
    out: PathBuf,
    /// Read from the appview's Postgres.
    #[arg(long, env = "DATABASE_URL", conflicts_with = "api")]
    database_url: Option<String>,
    /// Read from an appview's public API instead, e.g. https://observ.ing.
    #[arg(long)]
    api: Option<String>,
    /// With --database-url: fetch photos through this appview's media proxy
    /// rather than from each author's PDS.
    #[arg(long, requires = "database_url")]
    media_base: Option<String>,
    /// Number of observations to sample.
    #[arg(long, default_value_t = 500)]
    size: usize,
    /// Sampling seed. Same seed and source data, same sample.
    #[arg(long, default_value_t = 1)]
    seed: u64,
    /// Distinct identifiers the community ID needs, two thirds agreeing.
    /// 2 is research grade; 1 admits observer-only IDs.
    #[arg(long, default_value_t = 2)]
    min_identifiers: usize,
    /// Parallel photo downloads.
    #[arg(long, default_value_t = 8)]
    concurrency: usize,
    /// Replace an existing dataset in --out (annotations.json is kept).
    #[arg(long)]
    force: bool,
}

#[derive(Args)]
struct FlagArgs {
    /// Dataset directory.
    dataset: PathBuf,
    /// Sample ids (from samples.jsonl or index.html).
    #[arg(required = true)]
    ids: Vec<String>,
    /// More than one organism in frame.
    #[arg(long, conflicts_with = "single")]
    multi: bool,
    /// Exactly one organism in frame.
    #[arg(long)]
    single: bool,
    /// Region holding the identified organism: x,y,width,height as 0–1 fractions.
    #[arg(long, conflicts_with = "no_crop")]
    crop: Option<Crop>,
    /// Remove a crop.
    #[arg(long)]
    no_crop: bool,
    /// Leave these samples out of runs.
    #[arg(long, conflicts_with = "include")]
    exclude: bool,
    /// Undo --exclude.
    #[arg(long)]
    include: bool,
    #[arg(long)]
    note: Option<String>,
    /// Drop every flag on these samples.
    #[arg(long)]
    clear: bool,
}

#[derive(Args)]
struct RunArgs {
    /// Dataset directory.
    dataset: PathBuf,
    /// species-id base URL, as `name=url` or a bare URL. Repeat to compare.
    #[arg(long = "endpoint", short = 'e', required = true)]
    endpoints: Vec<run::Endpoint>,
    /// Suggestions to ask for.
    #[arg(long, default_value_t = 5)]
    limit: usize,
    /// Requests in flight per endpoint. Keep 1 for meaningful latency.
    #[arg(long, default_value_t = 1)]
    concurrency: usize,
    /// Don't send latitude/longitude (turns off the geo prior).
    #[arg(long)]
    no_location: bool,
    /// Don't send crops from annotations.json.
    #[arg(long)]
    no_crop: bool,
    /// Unscored requests per endpoint before timing starts.
    #[arg(long, default_value_t = 2)]
    warmup: usize,
    /// Score only the first N samples (smoke tests).
    #[arg(long)]
    max_samples: Option<usize>,
    /// Where results files go. Default: <dataset>/runs.
    #[arg(long)]
    out_dir: Option<PathBuf>,
    /// Per-request timeout in seconds.
    #[arg(long, default_value_t = 120)]
    timeout: u64,
    /// Also write the Markdown report here.
    #[arg(long)]
    report: Option<PathBuf>,
}

#[derive(Args)]
struct ReportArgs {
    /// Results files from `run`. The first is the baseline.
    #[arg(required = true)]
    results: Vec<PathBuf>,
    /// Write the report here instead of stdout.
    #[arg(long)]
    out: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Export(a) => {
            let source = match (a.database_url, a.api) {
                (_, Some(base)) => export::Source::Api { base },
                (Some(url), None) => export::Source::Db {
                    url,
                    media_base: a.media_base,
                },
                (None, None) => bail!("pass --database-url (or set DATABASE_URL) or --api"),
            };
            export::export(
                source,
                export::ExportOptions {
                    out: a.out,
                    size: a.size,
                    seed: a.seed,
                    min_identifiers: a.min_identifiers.max(1),
                    concurrency: a.concurrency,
                    force: a.force,
                },
            )
            .await
        }
        Command::Flag(a) => flag(a),
        Command::Run(a) => {
            let report_path = a.report.clone();
            let runs = run::run(run::RunOptions {
                dataset: a.dataset,
                endpoints: a.endpoints,
                limit: a.limit,
                concurrency: a.concurrency,
                location: !a.no_location,
                crop: !a.no_crop,
                warmup: a.warmup,
                max_samples: a.max_samples,
                out_dir: a.out_dir,
                timeout: Duration::from_secs(a.timeout),
            })
            .await?;
            let runs: Vec<run::RunFile> = runs.into_iter().map(|(_, r)| r).collect();
            emit(&report::render(&runs), report_path)
        }
        Command::Report(a) => {
            let runs = a
                .results
                .iter()
                .map(|p| dataset::read_json(p))
                .collect::<Result<Vec<run::RunFile>>>()?;
            emit(&report::render(&runs), a.out)
        }
    }
}

fn emit(report: &str, path: Option<PathBuf>) -> Result<()> {
    match path {
        Some(path) => {
            std::fs::write(&path, report)?;
            eprintln!("report: {}", path.display());
        }
        None => print!("{report}"),
    }
    Ok(())
}

fn flag(a: FlagArgs) -> Result<()> {
    let ds = dataset::Dataset::load(&a.dataset)?;
    let mut annotations = ds.annotations;
    for id in &a.ids {
        if !ds.samples.iter().any(|s| &s.id == id) {
            bail!("no sample {id} in {}", a.dataset.display());
        }
        let entry = annotations.entry(id.clone()).or_default();
        if a.clear {
            *entry = Annotation::default();
        }
        if a.multi {
            entry.multi_organism = Some(true);
        }
        if a.single {
            entry.multi_organism = Some(false);
        }
        if let Some(crop) = a.crop {
            entry.crop = Some(crop);
        }
        if a.no_crop {
            entry.crop = None;
        }
        if a.exclude {
            entry.exclude = true;
        }
        if a.include {
            entry.exclude = false;
        }
        if let Some(note) = &a.note {
            entry.note = Some(note.clone());
        }
        eprintln!("{id}: {}", serde_json::to_string(entry)?);
    }
    annotations.retain(|_, a| !a.is_empty());
    dataset::save_annotations(&a.dataset, &annotations)
}
