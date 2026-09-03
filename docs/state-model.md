# Observation state model

What is true about an observation between pressing submit and seeing it in a
feed, what is merely likely, and where the client papers over the difference.

This is the companion to [architecture.md](architecture.md), which describes the
pipeline. This one describes its *guarantees* — and its non-guarantees, which
are where the bugs live.

## The state machine

```
      createRecord returns              tap-ingester UPSERT
Composed ──────────────▶ PdsAcked ────────────────────────▶ Ingested
(client only)              │                                   │
                           │                            matview REFRESH
                           │                                   ▼
                           │                               Enriched
                           │                                   │
                           └────────── deleteRecord ───────────┤
                                                               ▼
                                                            Deleted
```

| State | Reached when | Who can see it |
|-------|--------------|----------------|
| `Composed` | The upload form has content, nothing is written | This browser tab |
| `PdsAcked` | `createRecord` returns — signed, committed, durable | The PDS; nobody through our API |
| `Ingested` | tap-ingester UPSERTs `ingester.occurrences` | Everyone, through the API |
| `Enriched` | The `community_ids` matview refresh includes it | Everyone, with consensus taxonomy |
| `Deleted` | `deleteRecord` commits and the ingester cascades | Nobody |

`PdsAcked → Ingested` is the gap this document is about. `Ingested → Enriched`
is a second, smaller one: the matview refresh is debounced
(`COMMUNITY_IDS_REFRESH_DEBOUNCE`, 2s in `tap-ingester/src/database.rs`) and
aggregates the whole identifications⋈occurrences join, so there is a real window
where a row is visible with `effectiveTaxonomy` but no `communityId` — the
taxonomy on screen is not yet the taxonomy it settles on. It is not a loading
state, and nothing polls for it.

## Why there is no server-side read-your-writes

Writes and reads take different paths:

```
write:  frontend ─▶ appview ─▶ PDS ─▶ relay ─▶ Tap ─▶ tap-ingester ─▶ ingester.occurrences
read:   frontend ─▶ appview ─────────────────────────────────────────▶ ingester.occurrences
```

The appview is **read-only on the `ingester` schema** — see the grants in
[architecture.md](architecture.md#database-tables) and the note in
`crates/observing-appview/src/routes/occurrences/write.rs` ("there is a single
writer for the occurrences"). So the API the frontend reads from is *physically
incapable* of serving a record it just wrote to the PDS. This isn't an
oversight: one writer per table is what keeps the firehose replay idempotent and
the ingester's UPSERT the only thing that can produce an occurrence row.

The consequence is that the write path's acknowledgement and the read path's
visibility are separated by an unbounded, un-SLA'd amount of wall-clock time,
and closing that gap is the client's job.

## What is given, proven, and merely measurable

Sorting the pipeline's properties into these three buckets is most of what this
document is for. Confusing the third for the first is what produces "my
observation disappeared" bugs.

### Given (a commit point, by construction)

- **`createRecord` returning means the record exists.** It is signed by the
  user's key and committed to their repo. Nothing downstream can un-make it.
  This is the real commit point of a submission — not ingestion.
- **The uri and cid are stable.** They identify the record for the rest of its
  life, which is why every client-side structure here is keyed on `uri`.
- **The user owns it.** It is on their PDS whether or not our appview ever
  learns about it, and it survives us losing the database entirely.

### Proven (verified, not assumed)

- **Authenticity of every ingested record.** Tap checks an MST inclusion proof
  and the repo signature on each commit before tap-ingester sees it
  (`architecture.md`, "Firehose Ingestion"). A row in `ingester.occurrences` is
  not "what some relay said" — it is cryptographically tied to the author's repo.
- **Idempotence of replay.** Ingest is an UPSERT keyed by uri, so redelivery,
  backfill, and cursor rewinds converge rather than duplicate.

### Measurable only (no guarantee, at any layer)

- **Ingest latency.** PDS → relay → Tap → tap-ingester has no SLA and no bound.
  Typically seconds; a relay backlog, a cross-repo backfill for a previously
  unknown DID, or a tap-ingester restart make it minutes. Nothing in the system
  promises otherwise, and nothing measures it either.
- **Ordering between two submissions.** They are separate commits on the
  firehose; nothing guarantees the ingester applies them in submit order.
- **Enrichment lag.** Debounced and coalesced (see above).

Both client-side timeouts are patience budgets fitted to the *typical* case, not
deadlines the pipeline agreed to:

| Constant | Value | Means |
|----------|-------|-------|
| `INGEST_POLL_WINDOW_MS` (`services/api.ts`) | 30s | How long we actively poll before giving up on a submission |
| `MAX_AGE_MS` (`store/pendingSlice.ts`) | 4 × the above = 2min | How long a persisted optimistic row is worth keeping |

They are expressed as multiples of one another deliberately: they used to be two
independent guesses that disagreed. Neither is derived from measured ingest lag,
because nothing measures it. If that ever changes, these are the two numbers to
re-derive.

## The three client-side projections

Between `PdsAcked` and `Ingested`, whether the author sees their own observation
depends on three independent pieces of state:

| Projection | Lives in | Survives a refetch? | Survives a reload? |
|------------|----------|---------------------|--------------------|
| The server's feed response | TanStack Query cache pages | It *is* the refetch | No (in-memory only) |
| The optimistic row | `pending.tombstones` + localStorage | Yes — merged at select time | Yes |
| The in-flight poll | `pending.submissions` + localStorage | n/a | Yes — re-armed by `App.tsx` |

Each can be present or absent independently, and the cells of that
cross-product are where this used to break:

- **Row in the cache pages, nothing else.** Any refetch destroys it. Deleting
  *any* observation calls `invalidateOccurrenceLists()`, so deleting an
  unrelated row made a just-posted one vanish — no reload required.
- **Poll persisted, row not.** A reload re-armed the spinner but had nothing to
  rebuild the row from: the persisted entry carried only `{uri, cid, kind,
  createdAt}`. The author saw a spinner and an empty space.

The fix is that the optimistic row is no longer part of what a refetch replaces.
It is held in `pendingSlice`, persisted, and merged into the feeds in
`useFeed`/`useProfileFeed`'s `select` (`mergePendingOccurrences`). A refetch
replaces the pages underneath it; the overlay is re-applied to the new ones.

### Session guarantees the client now provides

In the vocabulary of Terry et al. (1994), for the author's own submission:

- **Read-your-writes** — after `createRecord` returns, the observation appears
  in the author's home and profile feeds immediately and stays there across
  refetches and reloads.
- **Monotonic reads** — a row the author has seen does not disappear from under
  them.

Both are **client-side, time-bounded, and per-device**:

- They hold for `MAX_AGE_MS` from submission. Past that the optimistic row is
  dropped on load and only the server's answer stands.
- They are scoped to the browser that made the write. The same account on a
  phone sees nothing until the record is genuinely ingested.
- They are dropped on logout, like the query cache, so a shared device does not
  leak one viewer's in-flight writes to the next.
- Two tabs share one localStorage key per list and each writes the whole list,
  so the last writer wins. In practice both tabs are tracking the same
  submissions; a lost write costs at most an early-retired optimistic row.

Nothing here is a *system* guarantee. A second device, a different browser, or
another user reading the same feed gets no read-your-writes at all — they see
the observation when the ingester has it, and not before.

### If cross-device read-your-writes is ever needed

The overlay cannot provide it; only the server can. The shape would be an
appview-owned `pending_occurrences` table in the `appview` schema (which the
appview *can* write), UNIONed into the author's own feed until the ingester row
lands and dropped on ingest. That preserves the single-writer rule for canonical
data — different schema, different table, unambiguous ownership — and makes
read-your-writes a real server-side property. It costs a migration, a write
path, a feed-query change, and cleanup on ingest, which is why the client-side
overlay came first.

## Where this is enforced

- `frontend/src/store/pendingSlice.ts` — the optimistic rows, the in-flight
  polls, both localStorage mirrors, and the ages they are dropped at.
- `frontend/src/lib/query/occurrenceCache.ts` — `mergePendingOccurrences` (the
  overlay), plus `reconcileOccurrence` / `prependOccurrence` (the swap to
  canonical).
- `frontend/src/lib/query/hooks.ts` — where the overlay is applied.
- `frontend/src/store/submissionLifecycle.test.ts` — a model-based property
  suite that interleaves submit / ingest / timeout / refetch / reload / clock
  events in random orders and checks the invariants above after every step.
