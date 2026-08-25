# HappyView Evaluation

**Question:** Should observ.ing replace its backend with [HappyView](https://happyview.dev)?

**Verdict: No** — but on a narrower base than an earlier draft of this document claimed, and
not for the reason it led with. The geospatial objection that originally carried the
recommendation does not survive measurement: a Postgres generated column plus a GiST index closes
the gap for about fifteen lines of one-time DDL (see [Benchmark](#benchmark)). What remains is an
unfavourable trade, not a technical barrier — HappyView would replace roughly 2,600 of ~12,500
lines of backend, leave every expensive component untouched, make local setup longer rather than
shorter, and cost Tap's per-commit verification. Adopt it for a new, record-shaped project; not
for this one.

Evaluated 2026-08-24 against HappyView v2 (`gamesgamesgamesgamesgames/happyview`, Rust, MIT,
last pushed 2026-08-22).

## What HappyView is

A general-purpose AppView: you upload lexicons, and it generates XRPC endpoints, indexes matching
records off the network, and gives you OAuth and an admin dashboard. v2 collapsed v1's companion
services into a single binary — the release post's pitch is "One binary, no companion services,
and a lot fewer moving parts." SQLite is the default backend; Postgres is supported for larger
deployments. Real-time ingest is via Jetstream, with historical backfill from each user's PDS.

Three capabilities matter for this evaluation and are more permissive than they first appear:

- **`db.raw` is a real SQL escape hatch.** It "Supports `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and
  `CREATE TABLE` statements — use it for your own tables and to reach the record index directly."
  It does not translate dialects, so you write native Postgres, PostGIS included.
- **Custom tables coexist with HappyView's.** Since v2.10 its own tables are prefixed `happyview_`
  "so they won't collide with your own tables if you're sharing a database."
- **Scripts know who is calling.** Query scripts receive `caller_did` ("DID of the authenticated
  user (nil if unauthenticated)"). "No-auth mode" for query scripts restricts *PDS writes*, not
  viewer identity, so viewer-dependent responses are expressible.

Consequently, most of what follows is a cost argument. Where a workaround exists, it is described.

## Issues

Ordered by severity. **Major** is a significant cost or regression; **Moderate** is real but
manageable. Nothing here is a technical blocker — see [Benchmark](#benchmark) for why the one
that looked like a blocker is not.

| # | Issue | Severity |
|---|-------|----------|
| 1 | Replaces a small share of the backend, and mostly not the expensive share | Major |
| 2 | Stated motivation (simpler setup) does not hold — the slow prerequisites remain | Major |
| 3 | Domain logic is not replaced, and regresses if ported to Lua/WASM | Major |
| 4 | Ingest verification downgrade: Tap's MST + signature checks → unverified Jetstream | Major |
| 5 | Spatial reads need hand-written SQL, and cost ~2.3x on dense viewports | Moderate |
| 6 | Private location data loses role-level isolation | Moderate |
| 7 | Single-maintainer dependency in the critical path | Moderate |

### 1. Small replaceable surface (Major)

What HappyView would genuinely take over:

| Replaced | Size |
|----------|------|
| [`oauth.rs`](../crates/observing-appview/src/routes/oauth.rs) | 241 LOC |
| [`tap-ingester`](../crates/tap-ingester/) plumbing | ~2,058 LOC |
| Simple CRUD reads (comments, likes, interactions) | ~330 LOC |

Against a 7,496 LOC appview and a 4,965 LOC db layer. Even the write path is mostly domain logic —
[`occurrences/write.rs`](../crates/observing-appview/src/routes/occurrences/write.rs) is 653 LOC of
media handling, private-data splitting, and auto-ID, none of which HappyView generates.

The ingester plumbing is the most attractive target, and it is exactly the code whose replacement
costs the verification guarantee in issue 4.

### 2. The setup-simplification premise does not hold (Major)

The README budgets 20–40 minutes for cold setup and ~1.4 GB of downloads. That cost is the BioCLIP
model bundles plus the full Rust workspace compile. HappyView replaces neither. After a swap, local
setup still requires:

- PostgreSQL with PostGIS — for the generated column in issue 5 and the private-data table in issue 6
- ONNX Runtime and the ~1.4 GB model download — species-id is untouched
- A full Rust workspace build — species-id, taxonomy, and media cache all remain

...plus HappyView itself, its dashboard, its lexicon registration, and the Lua scripts backing the
map and private-data paths. Setup gets longer, not shorter.

This is the issue that most directly answers the question that prompted the evaluation.

### 3. Domain logic is not replaced, and regresses if ported (Major)

A large share of this backend is domain logic that no lexicon can generate:

| Component | Size | Notes |
|-----------|------|-------|
| [`observing-species-id`](../crates/observing-species-id/) | 860 LOC | BioCLIP ViT-H/ViT-L inference via ONNX Runtime |
| [`processing.rs`](../crates/observing-db/src/processing.rs) | 1,287 LOC | AT Protocol JSON → typed DB params, shared by appview + ingester |
| [`taxonomy_resolver.rs`](../crates/observing-db/src/taxonomy_resolver.rs) | 438 LOC | GBIF + Wikidata resolution with moka caching |
| [`community_ids.rs`](../crates/observing-db/src/community_ids.rs) | 399 LOC | iNaturalist-style consensus: per-user dedup, 2/3 majority, research-grade threshold |
| [`quality.rs`](../crates/observing-db/src/quality.rs) | 372 LOC | GBIF-style data-quality flags, filterable in SQL feeds |
| [`file-blob-cache`](../crates/file-blob-cache/) | 403 LOC | Filesystem-backed LRU blob/thumbnail cache |

Ported to HappyView, these move into Lua or WASM. Both are worse environments for this work:

- **Lua is sandboxed** — `io`, `debug`, `package`, `require`, `dofile`, `loadfile`, `load`, and
  `collectgarbage` are unavailable, with a 1,000,000-instruction ceiling that terminates the script
  on overrun.
- **WASM plugins** currently "only support third-party auth," per the v2 release post.

Neither can host ONNX inference, so species-id stays a separate Rust service regardless. Cached HTTP
taxonomy resolution and blob caching are possible but strictly more awkward than the current
implementations, and the consensus and quality algorithms would be reimplemented in a language with
an instruction budget.

Note that `processing.rs` is *not* needed to maintain the spatial column — Postgres does that
declaratively (issue 5). It is still needed for everything else it does: taxonomy denormalisation,
media parsing, observer relationships, and date-range handling.

### 4. Ingest verification downgrade (Major)

observ.ing ingests through [Tap](https://github.com/bluesky-social/indigo/tree/main/cmd/tap)
(`indigo cmd/tap`), which performs MST and signature verification per commit against the user's PDS
before re-emitting clean events to [`tap-ingester`](../crates/tap-ingester/). HappyView v2 streams
from Jetstream, which is an unverified convenience firehose.

For a platform producing Darwin Core biodiversity records intended to be scientifically citable,
provenance is part of the product. Trading verified sync for unverified streaming is a regression in
data integrity, not a plumbing detail. This is the one issue with no workaround inside HappyView —
though nothing stops running Tap alongside it and writing through `db.raw`, which again means
keeping the component the swap was meant to remove.

### 5. Spatial reads need hand-written SQL and cost ~2.3x on dense viewports (Moderate)

> **Earlier assessment revised.** Two previous drafts led with this as the decisive issue, on the
> reasoning that HappyView stores records as opaque JSONB with no spatial index, and that the only
> fix was a separate PostGIS projection table populated by an index hook — effectively rebuilding
> [`observing-db`](../crates/observing-db/). That was wrong. Postgres indexes expressions over
> JSONB directly, and a `GENERATED ALWAYS AS ... STORED` column is maintained by the storage engine
> with no hook, no second table, and no duplication. Measurements are in [Benchmark](#benchmark).

HappyView indexes every record from every collection into one generic table, composed here from
`migrations/postgres/`:

```sql
CREATE TABLE records (
    uri        TEXT PRIMARY KEY,
    did        TEXT NOT NULL,
    collection TEXT NOT NULL,
    rkey       TEXT NOT NULL,
    record     JSONB NOT NULL,
    cid        TEXT NOT NULL,
    indexed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_records_did_collection ON records (did, collection);
CREATE INDEX idx_records_collection      ON records (collection);
CREATE INDEX idx_records_created_at_uri  ON records (created_at DESC, uri DESC);
```

Out of the box that makes observ.ing's viewport read —
`location && ST_MakeEnvelope(...)` in
[`routes/occurrences/read.rs`](../crates/observing-appview/src/routes/occurrences/read.rs) —
a full scan: **254 ms** against 1M records, versus **0.23 ms** on the current schema.

**The fix is cheap and declarative.** One statement, run once through `db.raw`:

```sql
ALTER TABLE happyview_records ADD COLUMN loc geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN jsonb_typeof(record->'decimalLatitude')  = 'number'
          AND jsonb_typeof(record->'decimalLongitude') = 'number'
         THEN ST_SetSRID(ST_MakePoint((record->>'decimalLongitude')::float8,
                                      (record->>'decimalLatitude')::float8),4326)::geography
         ELSE NULL END
  ) STORED;
CREATE INDEX hv_loc_gist ON happyview_records USING GIST (loc);
```

That brings the sparse viewport to **0.33 ms** — within 1.4x of the current schema. Postgres
maintains the column on every insert; no index hook, no Lua, no second copy of the data.

What remains is real but bounded:

- **Dense viewports cost ~2.3x** (42 ms vs 18 ms for a 250k-row metro viewport). HappyView's rows
  carry the full JSONB inline, so any scan touching many rows reads roughly twice the bytes.
- **Storage is ~1.8x** — 647 MB vs 355 MB for the same 1M occurrences.
- **The endpoint is still yours to write.** A lexicon-generated query cannot emit
  `&& ST_MakeEnvelope(...)`, so the map endpoint is a Lua script issuing `db.raw` SQL. Marker
  clustering and the `ST_DWithin`/`ST_Distance` nearby search are likewise hand-written.
- **The type guard is mandatory, not optional.** Without the `jsonb_typeof` check, a single
  malformed record — `{"decimalLatitude": "47.6N"}` — raises
  `invalid input syntax for type double precision` and the **insert fails**, which on a firehose
  consumer means ingestion stalls on one bad record. This was reproduced; the guard fixes it.
- **PostGIS silently coerces out-of-range coordinates.** A latitude of `991.0` becomes a valid
  point with a `NOTICE`, not an error. Today [`quality.rs`](../crates/observing-db/src/quality.rs)
  flags that class of problem; pushed into a generated column, it disappears into plausible-looking
  data.

Write overhead is not a concern: 20k inserts went from 148 ms to 227 ms with the column and index
in place — ~53% slower, but both rates are orders of magnitude above any real firehose.

#### Why a generated column rather than a join table

A narrow side table — `occurrence_geom(uri PK, geom geography)` with a GiST index, kept in sync by
a Postgres trigger and joined at query time — is a legitimate alternative, and it avoids touching
HappyView's own table at all. It was benchmarked head-to-head against the generated column
([full numbers](#benchmark)). It loses on the queries observ.ing actually runs most:

| | Generated column | Join table |
|---|---|---|
| Map viewport, dense, `LIMIT 500` **+ payload** | **1.29 ms** | 3.45 ms |
| Map viewport, sparse, `LIMIT 500` **+ payload** | **0.39 ms** | 1.19 ms |
| `COUNT(*)` over dense viewport | 52.96 ms | **31.64 ms** |
| Nearby `ST_DWithin` + distance sort | 30.21 ms | **22.89 ms** |
| 20k inserts | **220 ms** | 384 ms |
| Total storage | **647 MB** | ~851 MB |

The map query needs the record payload regardless, so the join buys nothing on the hot path and
adds a primary-key lookup per row — 2.7x slower on the dense viewport. It also costs *more*
storage, because duplicating the long `at://` URI as a join key (306 MB with its PK and GiST
indexes) exceeds the generated column plus its index (+70 MB). And a per-row PL/pgSQL trigger is
74% slower on write than a column the storage engine maintains.

Where the join table genuinely wins is queries that never need the payload. Geography GiST indexes
are lossy, so a `COUNT` must recheck against the heap — and the join table's heap rows are tiny
where `happyview_records`' carry the full JSONB. That makes it ~1.7x faster for counts, which is
worth remembering, because **map marker clustering is exactly that shape**: count per tile, no
payload. If clustering becomes a hot path, a narrow companion table earns its place there
specifically.

On the "don't modify their table" argument for the join table: HappyView's migration history uses
in-place `ALTER TABLE` and, for the v2.10 prefixing, `ALTER TABLE records RENAME TO
happyview_records` — a rename preserves added columns, indexes, and generated columns. No
table-rewrite pattern appears in its migrations. The residual risk is a name collision, which a
prefixed column name (`observing_loc`, not `loc`) defuses.


### 6. Private location data loses role-level isolation (Moderate)

> **Earlier assessment revised.** A previous draft called this a blocker on the grounds that
> HappyView has no home for appview-owned data that never becomes a record. That was wrong.
> `db.raw` creates and writes arbitrary tables, and `caller_did` is available to query scripts, so
> the side table and the viewer-dependent disclosure are both expressible. What follows is the
> concern that actually survives.

[`private_data.rs`](../crates/observing-db/src/private_data.rs) stores exact coordinates,
`geoprivacy`, and `effective_geoprivacy` in `appview.occurrence_private_data` — data that
deliberately never reaches the PDS, since obfuscated coordinates are what gets published. That is
how sensitive-species protection works.

On HappyView this is buildable: a procedure script receives `caller_did` and `input`, proxies the
obfuscated record to the PDS, and `db.raw`-inserts exact coordinates into a side table; a query
script compares `caller_did` against the occurrence owner and swaps in exact coordinates when they
match. PostGIS types and a GiST index work there as they do today.

What is lost is isolation. Today exact coordinates sit in the `appview` schema, reachable only by
`appview_runtime`; `ingester_runtime` cannot read them, and only the one-shot migrate job holds
superuser. Under HappyView, `db` is "Available in all Lua scripts," and `db.raw`'s protection list
covers HappyView's own sensitive tables only — there is no mechanism to mark *your* table
protected. Any script added later, for any endpoint, by anyone with script-write permission, can
`SELECT * FROM occurrence_private_data`. The privilege separation the current
[architecture](architecture.md) is deliberate about collapses to a single trust boundary.

Notably, HappyView's own design treats this class of risk as real — it blocks its internal secrets
from `db.raw` by default. The gap is that the guarantee does not extend to tables you add.

### 7. Single-maintainer dependency (Moderate)

HappyView is a solo project (Trezy, built originally for Cartridge), ~87 stars, 17 open issues, v2
released 2026-04-24. It is active and the code quality looks sound, but placing it in the critical
ingest path makes observ.ing's data pipeline dependent on one person's continued availability.
Acceptable for a peripheral service; a real risk for the primary backend.

## Benchmark

Run 2026-08-24 to settle issue 5. 1,000,000 synthetic occurrence records — uniform across a
continental-US bounding box with a dense Seattle-metro hotspot, matching how biodiversity
observations actually cluster — loaded into both HappyView's `records` shape and observ.ing's
`occurrences` shape, in `imresamu/postgis:16-3.4` (PostgreSQL 16, PostGIS 3.4, `shared_buffers=512MB`).
Each figure is the median of 7 warm runs of `SELECT count(*)` over a viewport.

| Configuration | Sparse viewport (157 rows) | Dense viewport (250k rows) |
|---|---|---|
| HappyView `records`, no spatial index | 254 ms | 257 ms |
| HappyView + guarded generated column + GiST | **0.33 ms** | **42 ms** |
| observ.ing `occurrences` + GiST (current) | 0.23 ms | 18 ms |

Generated column versus a trigger-maintained narrow join table, same dataset — the map queries
select `uri, record` (the payload a map actually needs), not `count(*)`:

| Query | Generated column | Join table | observ.ing (current) |
|---|---|---|---|
| Map viewport, dense, `LIMIT 500` | 1.29 ms | 3.45 ms | 1.10 ms |
| Map viewport, sparse, `LIMIT 500` | 0.39 ms | 1.19 ms | — |
| `COUNT(*)`, dense viewport (250k) | 52.96 ms | 31.64 ms | 19.38 ms |
| Nearby `ST_DWithin` + sort, `LIMIT 50` | 30.21 ms | 22.89 ms | — |
| 20k inserts | 220 ms | 384 ms | — |
| Storage (total) | 647 MB | ~851 MB | 355 MB |

Supporting measurements:

| Metric | HappyView | observ.ing |
|---|---|---|
| Total relation size, 1M occurrences | 647 MB | 355 MB |
| GiST index build over 1M rows | ~3.1 s | — |
| 20k inserts, no spatial column | 148 ms | — |
| 20k inserts, generated column + GiST | 227 ms | — |

Two plan-level notes. A plain **expression** index — `CREATE INDEX ... USING GIST ((ST_SetSRID(...)))`
without a stored column — also works and builds in ~3.1 s, but the planner mis-estimated its
selectivity badly on the dense viewport (`rows=100` against 250,081 actual) and chose a plain index
scan at 447 ms; forcing a bitmap scan brought it to 52 ms. The stored generated column produced
stable plans and is the safer choice. Separately, the malformed-record failure in issue 5 was
originally observed against an unguarded expression index, not the generated column — the guard
belongs in whichever of the two is used.

**Caveats.** Synthetic data, one machine, Docker, `count(*)` rather than observ.ing's real
enriched projection — these numbers establish the *shape* of the difference (full scan vs indexed,
roughly 2x on dense reads), not production latencies. The container was removed after the run.

## Where HappyView could still be useful

Worth keeping in mind for adjacent work rather than a swap:

- **Prototyping new lexicons** before committing them to the real pipeline — upload, watch it index,
  iterate on the shape without touching migrations or `processing.rs`.
- **A lightweight public XRPC read mirror** for non-geospatial collections (likes, comments) if a
  protocol-native read API is ever wanted alongside the REST API.
- **A default for any future, smaller atproto project** where the query shape is record-oriented.

## Method and caveats

Findings are based on HappyView's published documentation, its Lua API reference and Postgres
migrations read directly from the repository, its v2.10 changelog, and the v2 release post; on this
repository's `.sqlx/` prepared statements, migrations, and crate sources; and on the schema-level
[benchmark](#benchmark) above.

Caveats:

- **HappyView itself was never run.** The benchmark reproduced its *schema* — the `records` table
  and its three indexes, verbatim from `migrations/postgres/` — and measured queries against it. It
  did not exercise HappyView's Jetstream ingest, Lua runtime, or XRPC layer. Query costs incurred
  *inside* Lua (per-row script execution, the 1M-instruction ceiling on a large result set) are
  therefore unmeasured, and could matter for the map endpoint.
- **The Lua paths in issues 5 and 6 are unbuilt.** The documented APIs support them and the SQL
  half is measured, but no script was written. Effort estimates are inferred from equivalent Rust,
  which is a proxy.
- **Issue 3's porting costs are judgement, not measurement.** No component was actually
  reimplemented in Lua.

The open question most worth settling, if this is revisited, is the one the benchmark could not
reach: whether a Lua query script can assemble observ.ing's enriched occurrence response — profiles,
community IDs, media URLs, quality flags — within its instruction budget at viewport scale. That
governs issue 3, which now carries more of the recommendation than issue 5 does.

## References

- [HappyView documentation](https://happyview.dev/) · [quickstart](https://happyview.dev/getting-started/quickstart) · [architecture](https://happyview.dev/reference/architecture)
- [Lua database API](https://github.com/gamesgamesgamesgamesgames/happyview/blob/main/packages/docs/content/docs/api-reference/lua/database-api.md) · [Lua scripting guide](https://happyview.dev/guides/lua-scripting)
- [HappyView v2.10 changelog](https://happyview.dev/blog/happyview-2.10)
- [Releasing HappyView 2 Into the Wild](https://trezy.com/blog/releasing-happyview-2-into-the-wild)
- [gamesgamesgamesgamesgames/happyview](https://github.com/gamesgamesgamesgamesgames/happyview)
- [Architecture](architecture.md) — observ.ing's current design
