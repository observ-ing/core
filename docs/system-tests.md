# System state tests: a recipe

Most bugs aren't in a single function. They happen where two parts of a system
disagree about what the state is: an event arrives twice, a background job
runs at an awkward moment, a derived value goes stale. Unit tests don't reach
these, and e2e tests only hit them by luck.

The pattern: **write down what should be true, throw messy real-world
scenarios at the real system, and check whether it's still true.** When it
isn't, shrink the scenario to the fewest steps that still fail.

It isn't tied to a language or framework. Any property-testing library
(proptest, fast-check, Hypothesis, prop_check) can generate and shrink the
scenarios; you supply four answers.

## The four questions

**1. What's the source of truth?**
The thing everything else is derived from. For the ingester it's the users'
repos. If two sides can both change the same data (e.g. a two-way sync with a
partner API), there's no single source of truth, and you need a written
conflict policy before you can go further. Writing that policy down is often
where the bugs show up.

**2. Given that truth, what should the system look like?**
A plain function from the source of truth to the expected state, in simple
terms rather than your tables: "these occurrences exist", "alice likes post
X", "this occurrence's consensus is *Quercus alba* with 2 votes".

**3. What can go wrong in the real world?**
List the messy things your system actually faces and make each one an action
the test can take:

- events arrive out of order, twice, or late
- a background job runs before, between, or after other steps
- an external call times out *after* it succeeded
- a record is edited, deleted, or re-created with the same key

**4. Does reality match?**
Run many random scenarios made of normal actions plus messy ones. After each
one, let everything settle (drain queues, run jobs), then compare the expected
state with what's actually in the database. On a mismatch, print the shortest
failing scenario and the difference.

## Rules that make it work

- **Actions do nothing when they can't apply.** Delivering from an empty
  queue or deleting a missing record is a no-op, so any subset of a scenario
  is still a valid scenario, and shrinking just removes steps.
- **Run the real code against a real database.** Mocks hide exactly the bugs
  this is for. Use a throwaway database, not a shared dev one.
- **Keep the world tiny.** A few users, a few IDs, a few values, so random
  scenarios collide constantly: edits hit live records, several people act on
  the same thing.
- **Fixed seeds in CI.** Same scenarios every run, so it's never flaky. Run
  random seeds separately (e.g. nightly) to explore.
- **Keep a known-bugs list.** Name each property. The test fails on a
  violation not in the list, *and* on a listed one that no longer reproduces,
  so each fix removes its entry and the list can't go stale.
- **Model what's intended, not what the code does.** Where they differ, it's
  either a bug or a decision nobody wrote down. Both are worth knowing.

## Example: tap-ingester

`crates/tap-ingester/src/sim/`

| Question | Answer |
|---|---|
| Source of truth | Records in users' repos (3 users × 3 keys × occurrence / identification / like) |
| Expected state | Occurrences, identifications, and likes mirror the repos; `community_ids` is the vote winner per occurrence; each notification is sent once |
| Messy actions | Tap delivers repos in any interleaving, redelivers the last event, resolve-taxa runs at any point; records are edited, deleted, re-created |
| Check | Drain every queue, run resolve-taxa, compare against the database |

- `model.rs`: the source of truth and the expected state
- `driver.rs`: runs events through the ingester's real write path (`apply_record`) against a throwaway database, and reads the result back
- `mod.rs`: properties, runner, shrinking, the known-bugs list

```sh
SIM_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
  cargo test -p tap-ingester sim -- --nocapture
```

`SIM_SEED=<n>` replays one scenario; `SIM_CASES`, `SIM_STEPS`, and
`SIM_BASE_SEED` widen the search. 300 scenarios take ~16s. CI runs it in the
`rust-sim` job.

Its first run found five bugs, each shrunk to 2–5 steps:

| Property | Bug | Shortest scenario |
|---|---|---|
| `identifications_match_repos` | Editing an identification can't clear `taxonRank` or `kingdom` (the upsert uses `COALESCE`) | create ID with rank → edit to no rank |
| `accepted_taxon_key_matches_name` | Renaming an identification keeps its old `accepted_taxon_key` forever, because resolve-taxa only looks at `NULL` keys | create ID → resolve → rename |
| `community_ids_match_model` | Follows from the `kingdom` bug: identical IDs land in separate vote groups | two users ID the same species, one clears kingdom |
| `likes_match_repos` | A second like record on the same occurrence is dropped, so deleting the first un-likes it in the DB while the repo still likes it | like → like again → delete first |
| `notifications_at_most_once` | No uniqueness constraint, so a redelivered event notifies again | like → deliver → redeliver |
