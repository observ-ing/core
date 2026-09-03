/**
 * Model-based property tests for the submit → visible lifecycle.
 *
 * A new observation is durable on the PDS as soon as `createRecord` returns but
 * unreadable from our API until the commit reaches `ingester.occurrences`, and
 * the appview is read-only on that schema. The gap is bridged entirely client
 * side by a tombstone row held in the pending slice and merged into the feeds at
 * select time (pendingSlice.ts + occurrenceCache.ts), plus a localStorage-backed
 * poll that retires it (pendingSlice.ts) — together, the whole state
 * machine between pressing submit and seeing the observation.
 *
 * fast-check interleaves the commands below in random orders, running
 * `checkInvariants` after every step. Only `fetchObservation`,
 * `pollObservation` and `Date.now` are stubbed; everything else is production
 * code.
 *
 * What the author sees is the cached pages *plus* the pending overlay
 * (`mergePendingOccurrences`), which is where a not-yet-ingested row lives —
 * so `visibleRows` reads through both, exactly as `useFeed` does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import fc from "fast-check";
import type { InfiniteData } from "@tanstack/react-query";
import type * as ApiModule from "../services/api";
import type { Occurrence, OccurrenceDetailResponse, Profile } from "../services/types";

// ── Controlled boundary ──────────────────────────────────────────────────────
// Stands in for `ingester.occurrences`. While `ingested` is false the API
// returns null, exactly as it does for a record just written to the PDS.
interface WorldRecord {
  uri: string;
  cid: string;
  ingested: boolean;
  /** Submission order, used to sort the server's newest-first response. */
  seq: number;
}

interface World {
  records: Map<string, WorldRecord>;
  /** Resolvers for outstanding `pollObservation` calls, keyed by uri. */
  polls: Map<string, (processed: boolean) => void>;
}

let world: World = { records: new Map(), polls: new Map() };
let now = Date.UTC(2026, 0, 1);

vi.mock("../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  fetchObservation: async (uri: string): Promise<OccurrenceDetailResponse | null> => {
    const rec = world.records.get(uri);
    return rec?.ingested ? { occurrence: canonical(rec), identifications: [], comments: [] } : null;
  },
  // The real one loops for ~30s; here the commands decide when it resolves.
  pollObservation: (uri: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      world.polls.set(uri, resolve);
    }),
}));

// Imported after the mock is registered so the thunks close over the stubs.
import authReducer, { logout } from "./authSlice";
import feedReducer from "./feedSlice";
import uiReducer from "./uiSlice";
import pendingReducer, {
  trackSubmission,
  resumePendingSubmissions,
  selectPendingOccurrences,
  MAX_AGE_MS,
} from "./pendingSlice";
import { makeTombstoneOccurrence, mergePendingOccurrences } from "../lib/query/occurrenceCache";
import { queryClient } from "../lib/query/queryClient";
import { qk } from "../lib/query/keys";

const AUTHOR: Profile = { did: "did:plc:author", handle: "author.example" };
const STORAGE_KEY = "observing-pending-submissions";
const TOMBSTONE_STORAGE_KEY = "observing-pending-tombstones";
const FEED_KEY = qk.feed("home", {}, true);
const PROFILE_KEY = qk.profileFeed(AUTHOR.did, "observations");

const uriOf = (n: number) => `at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/obs${n}`;
const cidOf = (n: number) => `bafycid${n}`;

/** The record as the API returns it once ingested — never mistakable for a tombstone. */
function canonical(rec: WorldRecord): Occurrence {
  return {
    uri: rec.uri,
    cid: rec.cid,
    observer: AUTHOR,
    effectiveTaxonomy: { scientificName: "Quercus alba", rank: "species", kingdom: "Plantae" },
    identificationCount: 1,
    location: { latitude: 1, longitude: 2 },
    images: [{ url: `https://cdn.example/${rec.cid}.jpg` }],
    createdAt: new Date(rec.seq).toISOString(),
    likeCount: 0,
    viewerHasLiked: false,
    qualityIssues: [],
  };
}

/**
 * A tombstone carries only what the submit form knew; the canonical record
 * carries the server-resolved taxonomy. Deliberately not keyed on the inline
 * `data:` preview — that is stripped on the way to localStorage, so a resumed
 * row would read as canonical.
 */
const isTombstone = (o: Occurrence) => o.effectiveTaxonomy?.scientificName === "Quercus";

type OccurrencePage = { occurrences: Occurrence[]; cursor?: string };

/** What `/feeds/home` would return right now: ingested records, newest first. */
function serverPage(): OccurrencePage {
  const rows = [...world.records.values()]
    .filter((r) => r.ingested)
    .sort((a, b) => b.seq - a.seq)
    .map(canonical);
  return { occurrences: rows };
}

function seedListCaches() {
  const page = serverPage();
  const data: InfiniteData<OccurrencePage> = { pages: [page], pageParams: [undefined] };
  queryClient.setQueryData(FEED_KEY, data);
  queryClient.setQueryData(PROFILE_KEY, { pages: [{ ...page }], pageParams: [undefined] });
}

function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, feed: feedReducer, ui: uiReducer, pending: pendingReducer },
  });
}
type TestStore = ReturnType<typeof makeStore>;

/**
 * What a feed hook renders for this store: the cached pages with the author's
 * pending rows merged on top, mirroring `useFeed`/`useProfileFeed`'s `select`.
 */
function visibleRows(store: TestStore, key: readonly unknown[]): Occurrence[] {
  const data = queryClient.getQueryData<InfiniteData<OccurrencePage>>(key);
  const merged = mergePendingOccurrences(data, selectPendingOccurrences(store.getState()));
  return merged?.pages.flatMap((p) => p.occurrences) ?? [];
}

/** Let the thunk's already-resolved promise chain run to completion. */
async function settle() {
  // Sequential by design: each tick advances one `await` in the chain.
  // eslint-disable-next-line no-await-in-loop
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function persistedUris(key: string): string[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  const parsed: { uri: string }[] = JSON.parse(raw);
  return parsed.map((s) => s.uri);
}

// ── Model / real ─────────────────────────────────────────────────────────────
interface Model {
  /**
   * How far each submission has got. `polled` = the poll settled either way;
   * `reconciled` = it settled successfully. A timed-out poll deliberately
   * leaves the tombstone alone, so the two must not be conflated.
   */
  submitted: Map<
    number,
    { ingested: boolean; polled: boolean; reconciled: boolean; submittedAt: number }
  >;
  /** Uris the author has actually seen in one of their own lists. */
  everSeen: Set<string>;
}

interface Real {
  store: TestStore;
}

/** Must hold after every lifecycle event, whatever the interleaving. */
function checkInvariants(model: Model, real: Real) {
  const feed = visibleRows(real.store, FEED_KEY);
  const profile = visibleRows(real.store, PROFILE_KEY);

  for (const rows of [feed, profile]) {
    // No duplicates: a tombstone and its canonical twin must never coexist.
    const uris = rows.map((r) => r.uri);
    expect(new Set(uris).size).toBe(uris.length);

    // No phantoms: every row traces back to something actually submitted.
    for (const uri of uris) expect(world.records.has(uri)).toBe(true);
  }

  // Once a poll reports success, any row still showing that record must be the
  // canonical one — swapping the tombstone out is `reconcileOccurrence`'s job.
  for (const [n, state] of model.submitted) {
    if (!state.reconciled) continue;
    const row = feed.find((r) => r.uri === uriOf(n));
    if (row) expect(isTombstone(row)).toBe(false);
  }

  // Monotonic reads, for as long as the client vouches for the row: a row the
  // author has already seen never disappears within MAX_AGE_MS of its
  // submission, whatever refetches or reloads happen in between. The guarantee
  // is deliberately time-bounded — past that the optimistic row is dropped on
  // load (see `loadPersisted`) and only the server's answer stands, which is
  // the honest limit of a client-side bridge.
  const feedUris = feed.map((r) => r.uri);
  for (const [n, state] of model.submitted) {
    const uri = uriOf(n);
    if (!model.everSeen.has(uri)) continue;
    if (now - state.submittedAt >= MAX_AGE_MS) continue;
    expect(feedUris).toContain(uri);
  }

  // A submission whose poll has settled is no longer in flight — no stale spinner.
  const inFlight = real.store.getState().pending.submissions.map((s) => s.uri);
  for (const [n, state] of model.submitted) {
    if (state.polled) expect(inFlight).not.toContain(uriOf(n));
  }

  checkStorageMirror(real);
}

/**
 * Both persisted lists mirror the store exactly: the in-flight set (which drives
 * the TopBar indicator and is re-armed on resume) and the optimistic rows (which
 * are what makes the observation visible after a reload).
 */
function checkStorageMirror(real: Real) {
  const { submissions, tombstones } = real.store.getState().pending;
  expect(persistedUris(STORAGE_KEY).sort()).toEqual(submissions.map((s) => s.uri).sort());
  expect(persistedUris(TOMBSTONE_STORAGE_KEY).sort()).toEqual(tombstones.map((t) => t.uri).sort());
}

function observe(model: Model, real: Real) {
  for (const row of visibleRows(real.store, FEED_KEY)) model.everSeen.add(row.uri);
}

// ── Commands ─────────────────────────────────────────────────────────────────
type Cmd = fc.AsyncCommand<Model, Real, false>;

/** The UploadModal `onSuccess` path: hand the thunk a tombstone, then poll. */
class Submit implements Cmd {
  constructor(readonly n: number) {}
  check(m: Model) {
    return !m.submitted.has(this.n);
  }
  async run(m: Model, r: Real) {
    const rec: WorldRecord = {
      uri: uriOf(this.n),
      cid: cidOf(this.n),
      ingested: false,
      seq: this.n,
    };
    world.records.set(rec.uri, rec);

    void r.store.dispatch(
      trackSubmission({
        uri: rec.uri,
        cid: rec.cid,
        kind: "create",
        occurrence: makeTombstoneOccurrence({
          uri: rec.uri,
          cid: rec.cid,
          observer: AUTHOR,
          latitude: 1,
          longitude: 2,
          scientificName: "Quercus",
          kingdom: "Plantae",
          imageUrls: [`data:image/jpeg;base64,preview${this.n}`],
          createdAt: new Date(now).toISOString(),
        }),
      }),
    );

    m.submitted.set(this.n, {
      ingested: false,
      polled: false,
      reconciled: false,
      submittedAt: now,
    });
    await settle();
    observe(m, r);
    checkInvariants(m, r);
  }
  toString() {
    return `Submit(${this.n})`;
  }
}

/** The commit reaches `ingester.occurrences` and the in-flight poll sees it. */
class IngesterDelivers implements Cmd {
  constructor(readonly n: number) {}
  check(m: Model) {
    const s = m.submitted.get(this.n);
    return !!s && !s.ingested;
  }
  async run(m: Model, r: Real) {
    const rec = world.records.get(uriOf(this.n));
    if (rec) rec.ingested = true;

    const resolve = world.polls.get(uriOf(this.n));
    const state = m.submitted.get(this.n);
    if (state) state.ingested = true;
    if (resolve) {
      world.polls.delete(uriOf(this.n));
      resolve(true);
      if (state) {
        state.polled = true;
        state.reconciled = true;
      }
    }

    await settle();
    observe(m, r);
    checkInvariants(m, r);
  }
  toString() {
    return `IngesterDelivers(${this.n})`;
  }
}

/** ~30s elapses without the ingester catching up; the poll gives up. */
class PollTimesOut implements Cmd {
  constructor(readonly n: number) {}
  check(m: Model) {
    const s = m.submitted.get(this.n);
    return !!s && !s.polled && world.polls.has(uriOf(this.n));
  }
  async run(m: Model, r: Real) {
    const resolve = world.polls.get(uriOf(this.n));
    world.polls.delete(uriOf(this.n));
    resolve?.(false);
    const state = m.submitted.get(this.n);
    if (state) state.polled = true;

    await settle();
    observe(m, r);
    checkInvariants(m, r);
  }
  toString() {
    return `PollTimesOut(${this.n})`;
  }
}

/**
 * What `invalidateOccurrenceLists()` does after any delete (mutations.ts:208):
 * the cached pages are replaced wholesale by the server's answer.
 */
class RefetchLists implements Cmd {
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    seedListCaches();
    await settle();
    observe(m, r);
    checkInvariants(m, r);
  }
  toString() {
    return "RefetchLists";
  }
}

/** Reload: query cache and store gone, localStorage survives, App.tsx re-arms the polls. */
class Reload implements Cmd {
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    // A reload tears down the whole JS context: every in-flight poll goes with
    // it, and only what `resumePendingSubmissions` re-arms below survives.
    // Without dropping them, a thunk from the previous page could still settle
    // and write the dead store's state over localStorage.
    world.polls.clear();
    queryClient.clear();
    r.store = makeStore();
    seedListCaches();
    await r.store.dispatch(resumePendingSubmissions());
    await settle();
    observe(m, r);
    checkInvariants(m, r);
  }
  toString() {
    return "Reload";
  }
}

/** Exercises the 2-minute `MAX_AGE_MS` cutoff on resume. */
class AdvanceClock implements Cmd {
  constructor(readonly ms: number) {}
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    now += this.ms;
    await settle();
    observe(m, r);
    checkInvariants(m, r);
  }
  toString() {
    return `AdvanceClock(${this.ms}ms)`;
  }
}

// ── Harness ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  world = { records: new Map(), polls: new Map() };
  now = Date.UTC(2026, 0, 1);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  localStorage.clear();
  queryClient.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
  localStorage.clear();
});

const OBS = 3;

const commandArbs = [
  fc.integer({ min: 0, max: OBS - 1 }).map((n) => new Submit(n)),
  fc.integer({ min: 0, max: OBS - 1 }).map((n) => new IngesterDelivers(n)),
  fc.integer({ min: 0, max: OBS - 1 }).map((n) => new PollTimesOut(n)),
  fc.constant(new RefetchLists()),
  fc.constant(new Reload()),
  fc.integer({ min: 0, max: 200_000 }).map((ms) => new AdvanceClock(ms)),
];

describe("submission lifecycle (model-based)", () => {
  it("holds its cache/pending invariants under arbitrary interleavings", async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commandArbs, { maxCommands: 20 }), async (cmds) => {
        world = { records: new Map(), polls: new Map() };
        now = Date.UTC(2026, 0, 1);
        localStorage.clear();
        queryClient.clear();

        await fc.asyncModelRun(() => {
          const model: Model = { submitted: new Map(), everSeen: new Set() };
          const real: Real = { store: makeStore() };
          seedListCaches();
          return { model, real };
        }, cmds);
      }),
      { numRuns: 300 },
    );
  }, 60_000);
});

// ── Session guarantees ───────────────────────────────────────────────────────
// The three scenarios that used to be pinned with `it.fails`. Each is the
// minimal counterexample fast-check shrank to; they stay as named regression
// tests because the shapes are specific and worth naming, while the general
// property above enforces the same properties under every interleaving.

describe("session guarantees", () => {
  async function scenario(...cmds: Cmd[]): Promise<[Model, Real]> {
    const model: Model = { submitted: new Map(), everSeen: new Set() };
    const real: Real = { store: makeStore() };
    seedListCaches();
    for (const cmd of cmds) if (cmd.check(model)) await cmd.run(model, real);
    return [model, real];
  }

  // Read-your-writes. A reload wipes the query cache, so the row cannot live
  // there: it is persisted with the pending entry and merged back in at select
  // time. `Reload` re-arms the poll and re-hydrates the row from localStorage.
  it("shows the author their own submission after a reload", async () => {
    const [, real] = await scenario(new Submit(0), new Reload());
    expect(real.store.getState().pending.submissions).toHaveLength(1); // still tracked…
    expect(visibleRows(real.store, FEED_KEY).map((r) => r.uri)).toContain(uriOf(0)); // …and shown
  });

  // Monotonic reads. Deleting any *other* observation refetches the feed from a
  // server that doesn't have this record yet. The overlay isn't part of what the
  // refetch replaces, so the row survives it.
  it("never removes a row the author has already seen", async () => {
    const [model, real] = await scenario(new Submit(0), new RefetchLists());
    expect(model.everSeen).toContain(uriOf(0));
    expect(visibleRows(real.store, FEED_KEY).map((r) => r.uri)).toContain(uriOf(0));
  });

  // `loadPersisted` writes the age-filtered list back, so an entirely-stale key
  // is cleared even though nothing downstream dispatches.
  it("clears expired submissions out of localStorage on resume", async () => {
    const [, real] = await scenario(new Submit(0), new AdvanceClock(MAX_AGE_MS), new Reload());
    expect(real.store.getState().pending.submissions).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(TOMBSTONE_STORAGE_KEY)).toBeNull();
    checkStorageMirror(real);
  });

  // The canonical record must be in the caches *before* the tombstone retires,
  // or the row blinks out between the two.
  it("swaps the tombstone for the canonical record without a gap", async () => {
    const [, real] = await scenario(new Submit(0), new IngesterDelivers(0));
    const mine = visibleRows(real.store, FEED_KEY).filter((r) => r.uri === uriOf(0));
    expect(mine).toHaveLength(1);
    expect(mine.map(isTombstone)).toEqual([false]);
    expect(real.store.getState().pending.tombstones).toHaveLength(0);
  });

  // A poll that gives up is not a failed write: the record is still coming, so
  // the row stands (and the spinner stops).
  it("keeps the optimistic row after the poll gives up", async () => {
    const [, real] = await scenario(new Submit(0), new PollTimesOut(0));
    expect(real.store.getState().pending.submissions).toHaveLength(0);
    expect(visibleRows(real.store, FEED_KEY).map((r) => r.uri)).toContain(uriOf(0));
  });

  // Optimistic rows outlive the page, so unlike the query cache they are not
  // dropped for free on logout — the next viewer on a shared device must not
  // inherit the previous one's in-flight writes.
  it("drops everything pending on logout", async () => {
    const [, real] = await scenario(new Submit(0));
    expect(visibleRows(real.store, FEED_KEY).map((r) => r.uri)).toContain(uriOf(0));

    real.store.dispatch(logout.fulfilled(undefined, "req"));

    expect(real.store.getState().pending.tombstones).toHaveLength(0);
    expect(visibleRows(real.store, FEED_KEY).map((r) => r.uri)).not.toContain(uriOf(0));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(TOMBSTONE_STORAGE_KEY)).toBeNull();
  });
});
