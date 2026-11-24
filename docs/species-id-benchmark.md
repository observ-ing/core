# Species-ID benchmark

`species-id-bench` (crate `crates/observing-species-id-bench`) measures how
often the species-id service names the right taxon, on photos the community
has already identified. Use it to check whether a change to
`observing-species-id` (center cropping, user crops, rank fallback, detection,
another model) helps, by running the old and new builds on the same frozen
set of photos.

It never changes the service. It talks to `/health` and `/identify` over
HTTP, so it can score any build on any port.

## Quick start

From the repository root, with the models downloaded
(`./scripts/download-models.sh`) and ONNX Runtime installed:

```bash
cargo build --release -p observing-species-id -p observing-species-id-bench
```

Start species-id (or use the one `process-compose up` runs on port 3005):

```bash
PORT=3005 MODEL_DIR=models/bioclip target/release/observing-species-id
```

Draw a dataset from observ.ing's public API, then score it:

```bash
target/release/species-id-bench export --api https://observ.ing --min-identifiers 1 --size 200 --out species-id-bench/observing-200
```

```bash
target/release/species-id-bench run species-id-bench/observing-200 -e main=http://localhost:3005
```

The report prints to stdout as Markdown (`--report FILE` writes it to a file
as well). `species-id-bench/` is gitignored; the photos stay on your machine.

## Comparing two builds

Build the other branch's service in its own checkout or worktree and start it
on another port, pointing at the same models:

```bash
PORT=3006 MODEL_DIR=/path/to/core/models/bioclip target/release/observing-species-id
```

Then pass both endpoints. The first is the baseline:

```bash
target/release/species-id-bench run species-id-bench/observing-200 -e main=http://localhost:3005 -e branch=http://localhost:3006
```

Endpoints run one after the other, never at the same time, so their
latencies don't skew each other. Each service holds about 3 GB, though, so on
a laptop short of memory start one build, run it, stop it, start the next,
and combine the saved runs with `report` (below). Each run is saved to
`<dataset>/runs/<time>-<name>.json`, so you can also run builds at different
times and compare the saved files later:

```bash
target/release/species-id-bench report species-id-bench/observing-200/runs/A-main.json species-id-bench/observing-200/runs/B-branch.json
```

The same works for request options on one build, e.g. `--no-location`
(turns off the geo prior) or `--no-crop` against a normal run.

## Ground truth

`export` keeps observations whose community ID has reached agreement under
the appview's own rule (`observing_db::community_ids::calculate`): each
user's latest identification counts once, and at least two thirds of
identifiers must agree. `--min-identifiers` (default 2, iNaturalist's
"research grade") is how many identifiers that takes. `1` also admits
observations only their observer has identified.

As of November 2026, production has no observation with two or more
identifiers in agreement, so the default exports nothing there and the
sample below uses `--min-identifiers 1`. That ground truth is the
observer's own ID; treat it as weaker, and switch to the default once
community identifications accumulate.

Each sample keeps the accepted taxon with its rank and ancestry (from the
GBIF-backed `taxa` cache, or the API's `effectiveTaxonomy`), the public
latitude/longitude (never the private exact location), and the observation's
first photo. Observations identified above family are left out, since none
of the metrics could score them.

Two sources produce the same dataset:

- `--database-url` (or `DATABASE_URL`): the appview's Postgres. Candidates
  are `ingester.community_ids` joined to `ingester.taxa` on the accepted
  taxon key; photos come from each author's PDS (or from an appview's media
  proxy with `--media-base https://observ.ing`). Needs read access to the
  `ingester` schema.
- `--api https://observ.ing`: the public explore feed and identifications
  API, for when you have no database access.

### Reproducibility

Candidates are ordered by `sha256(seed:occurrence URI)` and the first
`--size` that qualify are kept (`--seed`, default 1). The same seed on the
same data draws the same sample, and growing data mostly adds samples rather
than reshuffling. Because the data does grow, the dataset directory is the
reproducible unit: it stores the photos themselves and a `fingerprint` over
every sample's id and image hash. The report prints the fingerprint and
warns when compared runs scored different datasets.

```text
<dataset>/
  dataset.json       source, seed, size, rule, skip counts, fingerprint
  samples.jsonl      one sample per line: ids, image path and hash, taxon, location, agreement
  images/<id>.jpg    the photos
  annotations.json   review flags (optional, hand-made)
  index.html         contact sheet of every photo with its id and taxon
  runs/              results files from `run`
```

### Multi-organism photos and crops

Open `index.html` to review the photos, then flag samples by id:

```bash
target/release/species-id-bench flag species-id-bench/observing-200 3f2a9c01b7de --multi --crop 0.1,0.2,0.5,0.6
```

- `--multi` / `--single`: several organisms in frame, or exactly one.
- `--crop x,y,width,height`: where the identified organism is, as fractions
  of the image. `run` sends it as `crop` in the `/identify` body. Builds that
  don't support cropping ignore the field; `--no-crop` leaves it out.
- `--exclude`: leave a sample out of runs (wrong photo, unidentifiable).
- `--note`, `--clear`, `--no-crop`, `--include` edit or undo.

Flags live in `annotations.json`, apart from the samples, so `export --force`
keeps them. The report groups samples as flagged several, flagged one,
"several?" (the observer's organism count is above 1, not yet reviewed), and
not reviewed.

## Metrics

Per sample:

- **species top-1 / top-5**: the first one or five suggestions include the
  accepted species. Names are compared as lowercase binomials, so a
  subspecies or variety scores against its species. Only samples identified
  to species or below count.
- **genus top-1 / family top-1**: the first suggestion's genus or family is
  the accepted taxon's. A genus-level ID counts for genus and family.
- **rank fallback** (builds that return `fallback`): how often a broader
  taxon came back, how often it contained the accepted taxon, and species
  top-1 on photos with and without one.
- A request that fails counts as a miss.

Every rate is reported with its hits, denominator and Wilson 95% interval.
With a few hundred photos, a difference of a few points is usually noise;
the "Changes" table also counts the individual photos each build fixed and
broke.

Latency is wall-clock per request as the bench saw it (`--concurrency 1`
by default, after `--warmup 2` unscored requests) and the service's own
`inferenceTimeMs`, as p50/p90/p99.

## Caveats

- Names are matched as text. Where BioCLIP's label set and GBIF disagree on
  a name (synonyms, recent splits), a right answer scores as wrong.
- BioCLIP's training data includes iNaturalist photos. A photo cross-posted
  there may be one the model has seen; observ.ing-only photos are the
  cleanest held-out set.
- Two processes of the same build differ in the fourth decimal of their
  scores (ONNX Runtime threading), which now and then swaps two near-tied
  suggestions. Expect a stray fixed or broken photo between identical
  builds; look at the totals and intervals, not single photos.
- A service that is swapping heavily is slow, and in one run here it also
  returned scores off by up to 0.005. If a run's latency looks far off,
  re-run that build alone before trusting its accuracy.
- The release model bundle has no `species_geo_index.bin`, so a locally run
  service ranks on the photo alone, unlike production.

## Sample report

`main` is species-id at `a2ae1e5f`; `rank-fallback` is commit `9c1db271`,
which adds the optional `fallback` field. Both used the v2.0.0 model bundle
and ran one at a time on an Apple-silicon laptop, then were combined with
`report`. The dataset was drawn with `--min-identifiers 1` (see above).

Reading it: the fallback build leaves the suggestions alone (the one "fixed"
photo is within restart noise, below), and its fallback is right about 70%
of the time, firing mostly on photos whose top species is wrong (27% species
top-1 with a fallback, 82% without).

### Species-ID benchmark

Dataset `species-id-bench/observing-200`: 200 samples from `api:https://observ.ing`, fingerprint `3cba6a853a30`.

| run | endpoint | model | species | requests | errors | location | crop | limit |
|---|---|---|--:|--:|--:|---|---|--:|
| main | http://localhost:3105 | bioclip-2.5-vit-h-14 | 100000 | 200 | 0 | yes | 0 cropped | 5 |
| rank-fallback | http://localhost:3106 | bioclip-2.5-vit-h-14 | 100000 | 200 | 0 | yes | 0 cropped | 5 |

#### Accuracy

Cells: rate (hits/scored, Wilson 95% interval).

| kingdom | run | samples | species top-1 | species top-5 | genus top-1 | family top-1 |
|---|---|--:|--:|--:|--:|--:|
| all | main | 200 | 73.8% (121/164, 67–80) | 90.2% (148/164, 85–94) | 85.3% (162/190, 80–90) | 92.0% (184/200, 87–95) |
| all | rank-fallback | 200 | 74.4% (122/164, 67–80) | 90.2% (148/164, 85–94) | 85.3% (162/190, 80–90) | 92.0% (184/200, 87–95) |

#### Changes against `main`

On the samples both runs answered: a sample where either request failed is left out and counted under "failed", so outages don't read as regressions. Fixed: the baseline missed and this run hit; broke: the reverse.

| run | shared | failed | species top-1 Δ | species top-5 Δ | genus top-1 Δ | family top-1 Δ | species top-1 fixed / broke | genus top-1 fixed / broke |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| rank-fallback | 200 | 0 | +0.6 pp | +0.0 pp | +0.0 pp | +0.0 pp | 1 / 0 | 0 / 0 |

<details><summary>rank-fallback: species top-1 fixed (1)</summary>

| sample | accepted | main top-1 | rank-fallback top-1 |
|---|---|---|---|
| `75971cd3dd8b` | *Polygonum aviculare* | *Polygonum shastense* | *Polygonum aviculare* |

</details>

#### By kingdom

| Kingdom | run | samples | species top-1 | species top-5 | genus top-1 | family top-1 |
|---|---|--:|--:|--:|--:|--:|
| Animalia | main | 150 | 73.5% (97/132, 65–80) | 90.9% (120/132, 85–95) | 84.0% (121/144, 77–89) | 92.0% (138/150, 87–95) |
| Animalia | rank-fallback | 150 | 73.5% (97/132, 65–80) | 90.9% (120/132, 85–95) | 84.0% (121/144, 77–89) | 92.0% (138/150, 87–95) |
| Plantae | main | 48 | 74.2% (23/31, 57–86) | 87.1% (27/31, 71–95) | 90.9% (40/44, 79–96) | 91.7% (44/48, 80–97) |
| Plantae | rank-fallback | 48 | 77.4% (24/31, 60–89) | 87.1% (27/31, 71–95) | 90.9% (40/44, 79–96) | 91.7% (44/48, 80–97) |
| Fungi | main | 2 | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) | 50.0% (1/2, 9–91) | 100.0% (2/2, 34–100) |
| Fungi | rank-fallback | 2 | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) | 50.0% (1/2, 9–91) | 100.0% (2/2, 34–100) |

#### By organisms

| Organisms | run | samples | species top-1 | species top-5 | genus top-1 | family top-1 |
|---|---|--:|--:|--:|--:|--:|
| not reviewed | main | 175 | 72.1% (101/140, 64–79) | 89.3% (125/140, 83–93) | 84.8% (140/165, 79–90) | 91.4% (160/175, 86–95) |
| not reviewed | rank-fallback | 175 | 72.9% (102/140, 65–80) | 89.3% (125/140, 83–93) | 84.8% (140/165, 79–90) | 91.4% (160/175, 86–95) |
| several? (count > 1) | main | 25 | 83.3% (20/24, 64–93) | 95.8% (23/24, 80–99) | 88.0% (22/25, 70–96) | 96.0% (24/25, 80–99) |
| several? (count > 1) | rank-fallback | 25 | 83.3% (20/24, 64–93) | 95.8% (23/24, 80–99) | 88.0% (22/25, 70–96) | 96.0% (24/25, 80–99) |

#### By rank

| Rank | run | samples | species top-1 | species top-5 | genus top-1 | family top-1 |
|---|---|--:|--:|--:|--:|--:|
| species | main | 163 | 73.6% (120/163, 66–80) | 90.2% (147/163, 85–94) | 84.0% (137/163, 78–89) | 91.4% (149/163, 86–95) |
| species | rank-fallback | 163 | 74.2% (121/163, 67–80) | 90.2% (147/163, 85–94) | 84.0% (137/163, 78–89) | 91.4% (149/163, 86–95) |
| genus | main | 26 | – | – | 92.3% (24/26, 76–98) | 100.0% (26/26, 87–100) |
| genus | rank-fallback | 26 | – | – | 92.3% (24/26, 76–98) | 100.0% (26/26, 87–100) |
| family | main | 10 | – | – | – | 80.0% (8/10, 49–94) |
| family | rank-fallback | 10 | – | – | – | 80.0% (8/10, 49–94) |
| subspecies | main | 1 | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) |
| subspecies | rank-fallback | 1 | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) | 100.0% (1/1, 21–100) |

#### Rank fallback

Right: the accepted taxon falls inside the fallback taxon. The species top-1 columns show whether fallbacks land on the photos the model gets wrong.

| run | fallbacks | right | species top-1 with a fallback | species top-1 without | ranks |
|---|--:|--:|--:|--:|---|
| main | 0 of 200 | – | – | 73.8% (121/164, 67–80) | – |
| rank-fallback | 31 of 200 | 71.4% (20/28, 53–85) | 27.3% (6/22, 13–48) | 81.7% (116/142, 75–87) | class 2, family 5, genus 21, order 3 |

#### Latency

Wall: the whole request as the client saw it. Server: the service's own `inferenceTimeMs`. Failed requests are left out.

| run | wall p50 | wall p90 | wall p99 | wall max | server p50 | server p90 | server p99 |
|---|--:|--:|--:|--:|--:|--:|--:|
| main | 842 ms | 2304 ms | 3012 ms | 3171 ms | 839 ms | 2296 ms | 2994 ms |
| rank-fallback | 933 ms | 1183 ms | 1668 ms | 3830 ms | 930 ms | 1181 ms | 1660 ms |
