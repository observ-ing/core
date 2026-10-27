# Auto cross-post new observations to iNaturalist

## Context

#878 asked for three things: link an iNat account over OAuth, a preference to post
*new* occurrences to iNat, and a way to post an *existing* occurrence. The first and
third shipped (#920 through #971, #962). This plan covers the second: posting a new
observation to iNat as part of creating it, without a trip to its detail page.

It supersedes the August draft (`~/.claude/plans/help-me-think-through-hashed-reddy.md`),
which predates the shipped design. Where the two disagree, what shipped wins.

## What shipped, and how it differs from the August draft

| August draft | Shipped |
|---|---|
| `inat_accounts` / `inat_crossposts` tables | Service-agnostic `appview.linked_accounts` and `appview.crossposts`, keyed by `(…, service)` (`20261007000000_crossposts.sql`) |
| iNat link kept private, no lexicon footprint | Link is public: the worker writes an `externalRecords` entry back to the PDS record; `crossposts.external_uri` marks which entry is ours |
| In-process tokio worker in appview | `Task::InatCrossposts` on the single-instance `observing-worker`, driven by Cloud Tasks (`inat/worker.rs`, `routes/tasks.rs`) |
| Create and edit both push | Posted once. Later edits never touch iNat (`worker.rs`: "must not post it again") |
| Map CC license to iNat license code | Photos get the user's iNat default license (Settings copy says so) |
| v1 = new occurrences only | Reversed: "post existing" shipped first, as `POST /api/inat/crosspost` |
| `GET /api/inat/crosspost/{*uri}` | Shipped as drafted |
| Separate status chip on the detail page | `ExternalRecordsItem` / `useInatCrosspost` show status and the post/retry action |

Pieces this plan reuses as-is:

- `observing_db::crossposts::enqueue` (idempotent, requeues only `failed`).
- `state.tasks.enqueue(Task::InatCrossposts, Run { at, .. })`: `Run.at` already supports
  a delayed run.
- Deterministic observation and photo UUIDs (`inat/ids.rs`), so a duplicate run lands
  on the same iNat observation.
- `guard::check` for the "post existing" path; its rules carry over, but it needs an
  indexed occurrence, which a brand-new one isn't (see below).

## The one real problem: the worker can run before the ingester catches up

`create_occurrence` writes to the PDS and returns. The DB rows come later, from the
ingester. The worker reads the occurrence, the owner's identification, and remarks
from the index, so a job enqueued at create time can run too early in two ways:

1. **Occurrence not indexed yet.** The worker calls `gone()`, which is *permanent*.
   The cross-post fails at once with "The observation is no longer on observ.ing".
2. **Occurrence indexed, identification not yet.** Worse, because it is silent:
   `choose_taxon` finds no own identification, posts with `TaxonChoice::Unknown`, and
   because the observation is posted once, it is never corrected.

Records can reach the index in any order: a repo resync replays collections
alphabetically, and the FKs between occurrences and identifications were dropped
for exactly this (`20260602000000_drop_occurrence_ref_fks.sql`). So waiting for
"the last record written" isn't enough.

**As built:** record every URI the create request wrote on the crosspost row, and
have the worker wait until all of them are indexed.

- `crossposts.awaits_uris TEXT[]`: the occurrence, its remark records, and the
  auto identification if one was written (`written_records` in `write.rs`). The
  "post existing" path leaves it empty. `crossposts::all_indexed` checks them
  against `occurrences`, `identifications`, and `remarks` in one query.
- Waiting is not a failed attempt. Before `crosspost()`, `run_pending` checks the
  awaited records; if any are missing it calls `crossposts::defer`, which gives
  back the attempt the claim counted, bumps `waits`, and sets `not_before` 15s out.
  After `MAX_WAITS = 40` checks (about ten minutes) the crosspost fails for good
  with "observ.ing hadn't finished saving the observation in time", which the
  owner can retry from the detail page. The `MAX_ATTEMPTS` budget stays for
  iNaturalist's errors, so a slow ingester can't use it up.
- `crossposts.not_before TIMESTAMPTZ`: `claim_pending` skips a row until then, and
  `next_due_at` accounts for it. A new crosspost gets `not_before` 5s out, the same
  as its first `Run.at`, so a run already in progress (say, a batch) doesn't claim
  it the moment it is queued. Requeuing a failed crosspost resets `awaits_uris`,
  `waits`, and `not_before`.

`create_auto_identification` currently returns `()` and swallows a failed write; it
needs to return the identification URI (`Option<String>`) so the caller knows what
to await. If the identification write failed, await the occurrence instead, which
matches what "post existing" would do for that record.

Rejected alternatives:

- *Let the ingester enqueue when it indexes the occurrence.* Moves appview-only
  state (preferences, linked accounts) into the ingester, and still races the
  identification.
- *Just delay the first run by N seconds.* Fixes the common case and leaves both
  failure modes in place under ingester lag, which is exactly when they bite.
- *Make `gone()` transient for young rows.* Fixes (1) only.

## Implementation

### 1. Migration

`crates/observing-db/migrations/<ts>_crosspost_new_occurrences.sql`:

```sql
-- Whether new observations are cross-posted to iNaturalist by default.
-- NULL means the user never chose, which the client treats as off.
ALTER TABLE appview.user_preferences
    ADD COLUMN crosspost_inaturalist BOOLEAN;

-- Whether that default applies only to observations with photos. NULL means
-- the user never chose, which the client treats as on.
ALTER TABLE appview.user_preferences
    ADD COLUMN crosspost_inaturalist_require_photos BOOLEAN;

-- Records the ingester must have indexed before the crosspost may run.
ALTER TABLE appview.crossposts
    ADD COLUMN awaits_uris TEXT[] NOT NULL DEFAULT '{}';

-- How many times the crosspost has found the ingester not done yet.
ALTER TABLE appview.crossposts
    ADD COLUMN waits INTEGER NOT NULL DEFAULT 0;

-- The crosspost isn't claimed before this.
ALTER TABLE appview.crossposts
    ADD COLUMN not_before TIMESTAMPTZ;
```

Column name `crosspost_inaturalist` follows the one-nullable-column-per-pref pattern
in `20260516000000_user_preferences.sql`. Regenerate `.sqlx`.

### 2. Preferences

- `observing_db::user_preferences::{get, upsert}` and `UserPreferencesRow` gain the
  column.
- `routes/preferences.rs`: add `crosspost_inaturalist: Option<bool>` and
  `crosspost_inaturalist_require_photos: Option<bool>` to the request and response.
  As built, `PUT` became a partial update: an omitted field is left alone and
  `null` clears it (`user_preferences::PreferencesUpdate`, `Option<Option<_>>`).
  Otherwise a client from before this change (an installed Android build, a stale
  tab) would clear the crosspost preferences whenever it saved the basemap.
  `useUpdatePreferences` now sends only the patch, so toggling a switch before the
  preferences have loaded can't blank the others either.

### 2a. Filters on the default

Users want auto-posting to apply only to some observations. Start with **"only
observations with photos"**: without photos an iNat observation is "casual" and
never reaches research grade or GBIF, so posting them mostly adds noise to the
user's iNat profile. On by default (NULL = on) for that reason.

Filters decide the **default**, not what is allowed. They are evaluated in the
client when it decides whether to tick the box; the server still does exactly what
the request's explicit flag says. So:

- A user can still tick the box by hand for an observation that doesn't match the
  filters, and it posts. The filter is about not having to think, not a lock.
- The server needs no filter logic and the API stays explicit, per section 3.
- One pure function owns the rule, e.g. `defaultCrosspost(prefs, { photoCount })`
  in `frontend/src/lib/`, shared by the modal and the batch uploader and unit tested
  directly.

Adding photos or removing them in the modal re-evaluates the default *until the
user touches the checkbox*; after that, their choice sticks for that form.

Later filters slot into the same function and the same one-column-per-filter
pattern. "Only observations with identifications" is the obvious next one; at
create time that just means the request carries a scientific name, so it needs no
new server data either.

### 3. Write path: `routes/occurrences/write.rs`

- `CreateOccurrenceRequest` gains `#[ts(optional)] crosspost_to_inaturalist:
  Option<bool>`. The client sends the user's choice explicitly; the server does
  **not** fall back to the preference. That keeps the API's behavior visible in the
  request, and means an API client that never heard of the field never posts to iNat
  by surprise.
- After the auto identification, if the flag is true:
  - Skip (log at `info`) if `state.inat` is `None`, the user has no linked account,
    or `body.external_records` already contains an iNat record. As built, this
    calls `guard::check` itself (`check_new_crosspost`): a just-created occurrence
    is owned, has no crosspost row, and its `externalRecords` are the request's,
    so the existing rules apply unchanged and nothing needed factoring out.
  - `crossposts::enqueue` with `awaits_uris` and `not_before`, then `tasks.enqueue`
    with `Run.at` set to the same time.
  - **Never fail the request** over any of this: `warn!` and carry on, like the
    `private_data::save` call above it. The PDS write is the user's data.
- `UpdateOccurrenceRequest` is untouched: edits don't propagate.

`crossposts::enqueue` grows `awaits_uris: &[String]` and `not_before` parameters;
the existing call in `routes/inat.rs` passes `&[], None`.

### 4. Worker: `inat/worker.rs`

- The wait described above, in `run_pending` ahead of `crosspost()` (`ingested`,
  `after_check`). `CrosspostRow` gains `awaits_uris` and `waits`; `clear_awaits`
  empties the list once everything is in.
- `run_pending` logs the pending count and the age of the oldest at the start of
  each run (`crossposts::queue_stats`).

### 5. Frontend

- `InatSettings.tsx`: when linked, a switch "Post new observations to iNaturalist"
  bound to `crosspostInaturalist` via the existing preferences mutation, and under
  it, enabled only while that is on, "Only observations with photos" bound to
  `crosspostInaturalistRequirePhotos`. Update the section description, which
  currently says posting happens "from an observation's details".
- `UploadModal.tsx`, create mode only: a checkbox "Also post to iNaturalist" in the
  details step, shown only when `useInatAccount()` reports linked, initialized from
  `defaultCrosspost` (section 2a), folded into the submit payload. Hidden in edit
  mode, where the detail page's post action already covers it.
- Batch uploader: a per-observation `crosspost: boolean | null` on
  `BatchObservation` (`null` follows the preferences), edited like any other field
  by a "Also post to iNaturalist" checkbox in `BatchEditor` (desktop side panel)
  and `PhoneEditor` (phone). The box applies to the whole selection and shows
  indeterminate when the selection disagrees. Combining keeps the target's choice
  or takes a donor's; a split-off photo starts over at `null`. On upload each POST
  sends `crosspost ?? defaultCrosspost(...)`. Every batch observation is made from
  a photo and empty ones are dropped (`batchUpload.ts`), so "require photos" never
  excludes one and one default covers the batch.
- Detail page needs no change: a new occurrence's `pending` row already renders
  through `useInatCrosspost`.

## Decided

- **Default for users who never chose: off** (NULL = off). Auto-publishing to a
  third party should be something the user turned on, and users who linked under
  the current Settings copy were promised manual posting; NULL = on would change
  that under them. No post-link prompt either; the Settings switch is enough.
- **Batches and the shared rate limit: accept FIFO, add logging.** The limiter
  spaces calls 1s apart (`MIN_CALL_INTERVAL`), and an observation costs about
  2 + photos calls, so a 50 x 4-photo batch holds the queue ~5 minutes and anyone
  posting behind it waits. Waiting doesn't spend attempts (they're counted at
  claim), so nothing fails; it's only slow. At current scale that's acceptable.
  `run_pending` logs, per run, how many crossposts are pending and the age of the
  oldest, so waits are visible. If they show up, the fix is round-robin claiming
  across DIDs in `claim_pending` (`ROW_NUMBER() OVER (PARTITION BY did ...)`).
  Also watch iNat's ~10k calls/day cap, roughly 1,600 typical observations.
- **A manual change to the checkbox is not remembered.** Every new form starts from
  `defaultCrosspost`. Session memory risks a forgotten untick silently skipping
  observations the user wanted posted; a run of "don't post these" is what the
  Settings switch, or the batch editor's checkbox, is for.

## Carried over from the August draft, still true

- **Geoprivacy.** `write.rs` still hardcodes `"open"` for private data. When real
  geoprivacy lands, the cross-post must send exact coordinates with iNat's
  `geoprivacy: "obscured"`, never pre-obscured coordinates marked open. Auto-posting
  makes this more pressing, since nobody reviews each post.
- **GBIF double publication.** Now that the iNat link is public in `externalRecords`,
  a future DwC export can emit it as `otherCatalogNumbers` directly.
- **Import loops.** Any future iNat import must skip observations whose URI is in
  `crossposts.external_uri`.

## Verification

TDD order: write the failing test first for each item.

- `cargo test --workspace`:
  - Worker: `after_check` waits while records are missing and gives up after
    `MAX_WAITS`. There is no harness for running `run_pending` against a mocked
    iNat, so "posts with the identification's taxon once indexed" rests on the
    write path awaiting the identification plus the DB tests below.
  - Write path: `written_records` includes the occurrence, remarks, and
    identification; the guard refuses unlinked users and iNat `externalRecords`.
  - DB (`TEST_DATABASE_URL`): `all_indexed` waits for every record in any order;
    `not_before` keeps a new crosspost unclaimed; `defer` gives the attempt back;
    requeuing resets the wait; `queue_stats`; a preferences update leaves omitted
    fields alone.
- `npm test` (frontend unit): `defaultCrosspost` is false when posting is off;
  with "require photos" on or unset, false for zero photos and true for one; with it
  off, true for zero photos.
- `npm run test:e2e`: with `/api/inat/account` stubbed linked and the preference on,
  the upload modal shows the checkbox ticked and `crosspostToInaturalist: true`
  reaches the POST body; with no account, no checkbox. With "require photos" on, a
  photoless observation's box starts unticked. A form
  whose external records already link to iNat unticks and disables the box. Batch: the editor's box is ticked
  by default with the preference on; unticking one observation sends `false` for
  it alone; with a multi-selection, ticking sends `true` for all of them. CI never calls real iNat.
- Manual, against production iNat with a real account: tick the box, create an
  observation with an identification and two photos, confirm the iNat observation
  has the right taxon, both photos, and the link back. Repeat as a 5-item batch.
  Delete the test observations afterward.
- `npm run fmt`, `npm run lint`, `cargo fmt --all`.
