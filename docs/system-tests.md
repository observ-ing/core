# System-level state tests

Most of our bugs aren't in a single function — they're at the seams, where two
parts of the system disagree about what the state is: the firehose delivers
records out of order or twice, a background worker stamps a row that later
changes, a derived view drifts from its inputs. Unit tests don't reach those
bugs, e2e tests hit them only by luck, and LLM-written code is weakest exactly
here because the state flow isn't written down anywhere.

This doc describes a harness that makes the state flow explicit and checks it:
a **model** of how the system should behave, a thin **driver** into the real
system, **adversarial fakes** for everything outside our control, and a
**checker** that runs random scenarios, compares, and shrinks failures to a
minimal reproduction. v0 exists for tap-ingester
(`crates/tap-ingester/src/sim`); the rest is the roadmap.

## Shape

```
            ┌──────────────────────── harness ────────────────────────┐
            │  model / spec  ◀──▶  checker + shrinker  ◀── seeds       │
            │       │                     ▲                            │
            │  action generator      snapshots                         │
            └───────┬──────────────┬──────┴──────────┬─────────────────┘
                    │ drives       │ drives          │ observes
             ┌──────▼──────┐  ┌────▼──────┐    ┌─────▼─────┐
             │ adversarial │─▶│  system   │───▶│  driver   │
             │ fakes (Tap, │◀─│ under test│    │ (reset /  │
             │ GBIF, PDS)  │  └───────────┘    │ snapshot) │
             └─────────────┘                   └───────────┘
```

**Model.** The source of truth plus the rules for what the system should
derive from it, in the model's own vocabulary (not our tables). For the
ingester the source of truth is unambiguous — the repos — so the model is a map
of records and a projection function. Systems where both sides can write (a
two-way sync with a third-party API) need an explicit conflict policy in the
model; writing it down is often the most valuable part.

**Driver.** The only per-system code: reset to empty, apply an action through
the real code path, quiesce (drain queues, run workers), and snapshot (map real
rows into the model's vocabulary). The snapshot mapping is where the effort
goes.

**Adversarial fakes.** Controllable stand-ins for everything external, and the
harness decides how they misbehave: reorder, duplicate, delay, fail after
committing, rewind a cursor. Most suites mock externals as well-behaved, which
is exactly why these bugs survive.

**Checker.** Generates action sequences from a seed, runs them, compares the
snapshot with the model, and on failure shrinks the trace (delta debugging)
and prints the seed. Every action is total — no-ops when inapplicable — so any
subsequence of a trace is a valid trace and shrinking is trivial.

### Properties

A small catalog covers most real bugs:

1. **Convergence** — after the chaos stops and everything drains, derived state
   equals a function of the source of truth.
2. **Idempotence** — replaying any event (or any prefix of the stream) changes
   nothing.
3. **Legal transitions** — entities only move along allowed state-machine edges.
4. **No stuck states** — nothing is left `pending` after quiescence.
5. **Referential policy** — late or missing parents are handled the documented
   way (for us: soft references, see `20260602000000_drop_occurrence_ref_fks`).
6. **At-most-once side effects** — notifications, emails, external writes.

## v0: tap-ingester simulation (done)

`crates/tap-ingester/src/sim/`:

| File        | Role |
|-------------|------|
| `model.rs`  | Repos (3 DIDs × 3 rkeys × {occurrence, identification, like}), per-repo Tap delivery queues, trace generator, expected projection incl. `community_ids` consensus |
| `driver.rs` | `Driver` trait (the protocol, in-process) + `PgDriver`: scratch database, the real write path via `apply_record`, a fake GBIF resolve-taxa pass, snapshot queries |
| `mod.rs`    | Properties, runner, shrinker, `KNOWN_VIOLATIONS` ratchet |

The only production change is extracting `apply_record` from
`process_record` in `main.rs` so the sim drives exactly the code Tap events go
through.

Fault model: cross-repo reordering (assuming Tap orders within a repo only),
at-least-once redelivery of a repo's last event, resolve-taxa running at any
point, deletes, edits, and re-creates at the same rkey.

Run it (needs Postgres with PostGIS; it creates and drops its own database):

```sh
SIM_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
  cargo test -p tap-ingester sim -- --nocapture
```

`SIM_CASES` / `SIM_STEPS` / `SIM_BASE_SEED` widen the search; `SIM_SEED=<n>`
replays one trace. 300 × 40-step traces take ~16s locally. The `rust-sim` CI job
runs it on fixed seeds.

### What it found

First run, against main, each shrunk to a 2–5 step reproduction:

| Property | Bug | Minimal trace |
|---|---|---|
| `identifications_match_repos` | `identifications::upsert` COALESCEs `taxon_rank`/`kingdom` on conflict, so an edit that clears them is ignored | put ID (rank=species) → edit ID (rank=None) |
| `accepted_taxon_key_matches_name` | The same upsert keeps a resolved `accepted_taxon_key` when the name changes; resolve-taxa only visits `NULL` keys, so the stale key is permanent and consensus/filters use the old taxon | put ID "Q. rubra" → deliver → resolve → edit to "Q. alba" |
| `community_ids_match_model` | Downstream of the kingdom COALESCE: two identical IDs land in different `(name, kingdom)` vote groups, so consensus shows 1 vote instead of 2 | two users ID "Q. alba", one clears kingdom |
| `likes_match_repos` | `likes::create` is `ON CONFLICT (subject_uri, did) DO NOTHING`: a second like record on the same subject is dropped, so deleting the first leaves the DB saying "not liked" while the repo still has a like | like r0 → like r1 (same subject) → delete r0 |
| `notifications_at_most_once` | `notifications` has no uniqueness; any redelivery (or edit) of an ID/comment/like notifies again | like → deliver → redeliver |

Also noted: a like whose subject changes under the same rkey (legal atproto, not
something our app does) is rejected outright on `likes_pkey`. The generator
keeps likes immutable so that doesn't mask the realistic like bug; it's a
candidate fault knob.

These are ratcheted in `KNOWN_VIOLATIONS`: CI fails on any *new* violation, and
on a listed one that stops reproducing, so each fix PR deletes its entry.

## Roadmap

### v0.x — deepen the ingester model

- Fix the five findings above, one ratchet entry at a time.
- Cover comments and interactions, and account deletion / takedown.
- **Stale redelivery.** The subject-resolver path suppresses an ack
  (`mem::forget`) while later events for the same repo keep flowing, so Tap can
  redeliver an *older* event after a newer one. Model it as a fault and see what
  resurrects.
- **Cursor rewind.** Replay an arbitrary prefix of the stream after a reconnect
  (idempotence property).
- Run the real resolve-taxa code: move its name pass into `observing-db` behind
  a `TaxonomyUpstream` the sim can fake, instead of the mirrored SQL.
- Fake the PDS for `associatedMedia` resolution so occurrences with media are in
  scope.
- Nightly job with a random `SIM_BASE_SEED` and more cases; failing seeds get
  pinned as regression cases.
- Report model coverage (which action/state combinations were exercised), not
  line coverage.

### v1 — language-agnostic harness

Pull the harness out of process so any app can plug in by implementing a small
driver, and the model, generator, fakes, and checker are shared:

```
POST /reset       {seed}              fresh db, fresh fakes
POST /apply       {action, args}      call real service objects / handlers
POST /quiesce                         drain job queues, flush consumers
POST /clock       {advance_ms}        controllable time
GET  /snapshot -> abstract state      rows → model vocabulary
```

- The harness (likely TypeScript) owns models, generators, shrinking, seeds,
  JUnit output, and the ratchet.
- The Rust ingester driver becomes a test-only HTTP endpoint wrapping what
  `PgDriver` does today.
- The same shape fits e.g. a Rails app syncing with a third-party API: a
  test-only engine as the driver (service objects on `/apply`, drain ActiveJob
  on `/quiesce`, ActiveRecord queries on `/snapshot`) and a harness-controlled
  fake of the third party that times out after committing, duplicates and
  reorders webhooks, and changes state mid-sync.
- Fakes become shared, reusable components (a fake relay/Tap, a fake PDS, a
  fake webhook sender).

### v2 — beyond generated traces

- **Passive checking.** Emit structured state-transition events via `tracing`
  and validate staging/prod traces against the same model (AWS does this with P
  and PObserve). Catches what the generator never thought to try.
- **Exhaustive checking of the protocol.** For the gnarliest pieces (delivery,
  ack suppression, cursor handling) write a Quint spec and model-check it; use
  it to generate traces for the driver.
- **Real concurrency.** v0/v1 serialize actions, which finds ordering bugs but
  not true races. Concurrent `/apply` with a controlled scheduler, or a
  deterministic-simulation platform (Antithesis), is the next step up.

## Design decisions

- **In-process first.** The fastest route to finding real bugs, in the
  language the system is written in. The `Driver` trait is the protocol, so
  v1 is an extraction rather than a rewrite.
- **Executable reference model, not a spec language (yet).** A Rust model gets
  most of the value and anyone on the team can read it. Quint earns its keep
  later, for exhaustive checking of small protocols.
- **Fixed seeds in CI.** Deterministic and non-flaky; random exploration runs
  nightly and pins what it finds.
- **Scratch database per run, `TRUNCATE` per case.** Never touches a dev
  database, fast enough for hundreds of cases.
- **The model encodes intent, not the implementation.** Where the two differ,
  that's either a bug or a design decision nobody wrote down. For example,
  splitting consensus votes by `(name, kingdom)` is modeled as intended even
  though it's debatable.

## Prior art

- fast-check model-based testing / Hypothesis stateful testing /
  `proptest-state-machine`: the single-process version of v0.
- Jepsen / Elle: adversarial fakes and history checking for databases.
- P + PObserve (AWS): specs checked against production logs (v2 passive mode).
- Quint / TLA+ with trace validation: exhaustive protocol checking.
- Antithesis: deterministic hypervisor + language-agnostic assertion SDKs,
  the closest commercial product to the whole picture.
