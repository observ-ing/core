/**
 * Model-based property tests for the submit → visible lifecycle.
 *
 * A new observation is durable on the PDS as soon as `createRecord` returns but
 * unreadable from our API until the commit reaches `ingester.occurrences`, and
 * the appview is read-only on that schema. The gap is bridged entirely client
 * side by a tombstone row in the query caches (occurrenceCache.ts) plus a
 * localStorage-backed poll (pendingSlice.ts) — together, the whole state
 * machine between pressing submit and seeing the observation.
 *
 * fast-check interleaves the commands below in random orders, running
 * `checkInvariants` after every step. Only `fetchObservation`,
 * `pollObservation` and `Date.now` are stubbed; everything else is production
 * code. Properties that don't hold today are pinned with `it.fails` below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import fc from "fast-check";
import { InfiniteQueryObserver, type InfiniteData } from "@tanstack/react-query";
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
import authReducer from "./authSlice";
import feedReducer from "./feedSlice";
import uiReducer from "./uiSlice";
import pendingReducer, { trackSubmission, resumePendingSubmissions } from "./pendingSlice";
import {
  invalidateOccurrenceLists,
  makeTombstoneOccurrence,
  prependOccurrence,
} from "../lib/query/occurrenceCache";
import { queryClient } from "../lib/query/queryClient";
import { qk } from "../lib/query/keys";

const AUTHOR: Profile = { did: "did:plc:author", handle: "author.example" };
const STORAGE_KEY = "observing-pending-submissions";
// Mirrors `MAX_AGE_MS` in pendingSlice.ts, which does not export it.
const MAX_AGE_MS = 2 * 60 * 1000;
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

/** Tombstones carry the uploader's own inline preview; canonical rows never do. */
const isTombstone = (o: Occurrence) => o.images.some((i) => i.url.startsWith("data:"));

type OccurrencePage = { occurrences: Occurrence[]; cursor?: string };

/** What `/feeds/home` would return right now: ingested records, newest first. */
function serverPage(): OccurrencePage {
  const rows = [...world.records.values()]
    .filter((r) => r.ingested)
    .sort((a, b) => b.seq - a.seq)
    .map(canonical);
  return { occurrences: rows };
}

const LIST_KEYS = [FEED_KEY, PROFILE_KEY] as const;

function seedListCaches() {
  for (const key of LIST_KEYS) {
    const data: InfiniteData<OccurrencePage> = { pages: [serverPage()], pageParams: [undefined] };
    queryClient.setQueryData(key, data);
  }
}

/**
 * Keep the author's two lists *observed*. `invalidateQueries` only refetches
 * queries something is subscribed to, and no component is mounted here — without
 * this, `invalidateOccurrenceLists()` would be a silent no-op and `RefetchLists`
 * would have to reimplement it. `staleTime: Infinity` keeps the seeded data from
 * triggering a fetch on subscribe, so only an explicit invalidate refetches.
 */
let listSubscriptions: (() => void)[] = [];

function unmountListCaches() {
  for (const unsubscribe of listSubscriptions) unsubscribe();
  listSubscriptions = [];
}

function mountListCaches() {
  unmountListCaches();
  for (const queryKey of LIST_KEYS) {
    const observer = new InfiniteQueryObserver<OccurrencePage>(queryClient, {
      queryKey,
      queryFn: () => serverPage(),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      retry: false,
    });
    listSubscriptions.push(observer.subscribe(() => {}));
  }
}

/** Seed the caches from the current world and start observing them. */
function openLists() {
  seedListCaches();
  mountListCaches();
}

function rowsIn(key: readonly unknown[]): Occurrence[] {
  const data = queryClient.getQueryData<InfiniteData<OccurrencePage>>(key);
  return data?.pages.flatMap((p) => p.occurrences) ?? [];
}

function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, feed: feedReducer, ui: uiReducer, pending: pendingReducer },
  });
}
type TestStore = ReturnType<typeof makeStore>;

/**
 * Let the thunk's already-resolved promise chain run to completion. Yielding to
 * the macrotask queue drains every microtask queued behind it, so one turn is
 * enough however deep the promise chain gets.
 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface PersistedEntry {
  uri: string;
  createdAt: number;
}

function persistedEntries(): PersistedEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed: PersistedEntry[] = JSON.parse(raw);
  return parsed;
}

const persistedUris = (): string[] => persistedEntries().map((s) => s.uri);

// ── Model / real ─────────────────────────────────────────────────────────────
interface Model {
  /**
   * How far each submission has got. `polled` = the poll settled either way;
   * `reconciled` = it settled successfully. A timed-out poll deliberately
   * leaves the tombstone alone, so the two must not be conflated.
   */
  submitted: Map<number, { ingested: boolean; polled: boolean; reconciled: boolean }>;
  /** Uris the author has actually seen in one of their own lists. */
  everSeen: Set<string>;
}

interface Real {
  store: TestStore;
}

/** Must hold after every lifecycle event, whatever the interleaving. */
function checkInvariants(model: Model, real: Real) {
  const feed = rowsIn(FEED_KEY);
  const profile = rowsIn(PROFILE_KEY);

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

  // A submission whose poll has settled is no longer in flight — no stale spinner.
  const inFlight = real.store.getState().pending.submissions.map((s) => s.uri);
  for (const [n, state] of model.submitted) {
    if (state.polled) expect(inFlight).not.toContain(uriOf(n));
  }

  // The pending set is mirrored into localStorage so a reload can re-arm the
  // polls. Strict equality doesn't hold today — `loadPersisted` drops expired
  // entries without writing the filtered list back (pinned below) — so state the
  // two directions that do: nothing in flight is ever missing from storage, and
  // anything left in storage that isn't in flight has aged past the cutoff.
  // Without this, a `persist()` that stopped writing would go unnoticed.
  const persisted = persistedEntries();
  const persistedUriSet = new Set(persisted.map((s) => s.uri));
  for (const uri of inFlight) expect(persistedUriSet).toContain(uri);
  for (const entry of persisted) {
    if (inFlight.includes(entry.uri)) continue;
    expect(now - entry.createdAt).toBeGreaterThanOrEqual(MAX_AGE_MS);
  }
}

/** The pending set drives the TopBar indicator; localStorage mirrors it across reloads. */
function checkStorageMirror(real: Real) {
  const inFlight = real.store.getState().pending.submissions.map((s) => s.uri);
  expect([...persistedUris()].sort()).toEqual([...inFlight].sort());
}

/** Both of the author's own lists are on screen; either one counts as "seen". */
function observe(model: Model) {
  for (const key of LIST_KEYS) {
    for (const row of rowsIn(key)) model.everSeen.add(row.uri);
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────
type Cmd = fc.AsyncCommand<Model, Real, false>;

/** The exact row the UploadModal splices in on a successful PDS write. */
function tombstoneFor(n: number): Occurrence {
  return makeTombstoneOccurrence({
    uri: uriOf(n),
    cid: cidOf(n),
    observer: AUTHOR,
    latitude: 1,
    longitude: 2,
    scientificName: "Quercus",
    kingdom: "Plantae",
    imageUrls: [`data:image/jpeg;base64,preview${n}`],
    createdAt: new Date(now).toISOString(),
  });
}

/** The UploadModal `onSuccess` path: splice a tombstone, then start polling. */
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

    prependOccurrence(tombstoneFor(this.n), AUTHOR.did);
    void r.store.dispatch(trackSubmission({ uri: rec.uri, cid: rec.cid, kind: "create" }));

    m.submitted.set(this.n, { ingested: false, polled: false, reconciled: false });
    await settle();
    observe(m);
    checkInvariants(m, r);
  }
  toString() {
    return `Submit(${this.n})`;
  }
}

/**
 * `onSuccess` running twice for one write — React strict-mode re-invocation, or
 * a resumed poll racing the modal. `prependOccurrence` guards against it by uri;
 * without that guard the row would appear twice, which is what the no-duplicates
 * invariant is there to catch.
 */
class ResubmitSameRow implements Cmd {
  constructor(readonly n: number) {}
  check(m: Model) {
    // Only while the submission is still in flight: both real causes of a
    // double `onSuccess` happen before the poll settles.
    const s = m.submitted.get(this.n);
    return !!s && !s.polled;
  }
  async run(m: Model, r: Real) {
    prependOccurrence(tombstoneFor(this.n), AUTHOR.did);
    await settle();
    observe(m);
    checkInvariants(m, r);
  }
  toString() {
    return `ResubmitSameRow(${this.n})`;
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
    observe(m);
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
    observe(m);
    checkInvariants(m, r);
  }
  toString() {
    return `PollTimesOut(${this.n})`;
  }
}

/**
 * Any delete calls `invalidateOccurrenceLists()` (mutations.ts:208). We call the
 * real one — the lists are observed (see `mountListCaches`), so its tag predicate
 * has to actually match them for the refetch to happen.
 */
class RefetchLists implements Cmd {
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    await invalidateOccurrenceLists();
    await settle();
    observe(m);
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
    unmountListCaches();
    queryClient.clear();
    // The previous page's polls die with it; `resumePendingSubmissions` arms new
    // ones. Without this the old resolvers linger and `PollTimesOut` can't tell
    // a re-armed poll from a leaked one.
    world.polls.clear();
    r.store = makeStore();
    openLists();
    await r.store.dispatch(resumePendingSubmissions());
    await settle();
    observe(m);
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
    observe(m);
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
  unmountListCaches();
  vi.restoreAllMocks();
  queryClient.clear();
  localStorage.clear();
});

const OBS = 3;

const commandArbs = [
  fc.integer({ min: 0, max: OBS - 1 }).map((n) => new Submit(n)),
  fc.integer({ min: 0, max: OBS - 1 }).map((n) => new IngesterDelivers(n)),
  fc.integer({ min: 0, max: OBS - 1 }).map((n) => new PollTimesOut(n)),
  fc.integer({ min: 0, max: OBS - 1 }).map((n) => new ResubmitSameRow(n)),
  fc.constant(new RefetchLists()),
  fc.constant(new Reload()),
  fc.integer({ min: 0, max: 200_000 }).map((ms) => new AdvanceClock(ms)),
];

describe("submission lifecycle (model-based)", () => {
  it("holds its cache/pending invariants under arbitrary interleavings", async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commandArbs, { maxCommands: 20 }), async (cmds) => {
        unmountListCaches();
        world = { records: new Map(), polls: new Map() };
        now = Date.UTC(2026, 0, 1);
        localStorage.clear();
        queryClient.clear();

        await fc.asyncModelRun(() => {
          const model: Model = { submitted: new Map(), everSeen: new Set() };
          const real: Real = { store: makeStore() };
          openLists();
          return { model, real };
        }, cmds);
      }),
      { numRuns: 300 },
    );
  }, 60_000);
});

// ── Pinned violations ────────────────────────────────────────────────────────
// Session guarantees that don't hold today, written as the property we WANT and
// marked `it.fails` so CI stays green while the gap stays visible. When one is
// fixed its test goes red: promote it to `it` and, where it applies, fold the
// invariant into `checkInvariants`. The first two scenarios are the minimal
// counterexamples fast-check shrank to.

describe("session guarantees (known violations)", () => {
  async function scenario(...cmds: Cmd[]): Promise<[Model, Real]> {
    const model: Model = { submitted: new Map(), everSeen: new Set() };
    const real: Real = { store: makeStore() };
    openLists();
    for (const cmd of cmds) if (cmd.check(model)) await cmd.run(model, real);
    return [model, real];
  }

  // Each `it.fails` below carries exactly ONE assertion, because `it.fails`
  // passes on *any* error: fold a precondition in and a regression that breaks
  // the precondition instead keeps the test green while it silently stops
  // testing what it names. The preconditions hold today, so they are asserted
  // here as ordinary tests that go red on their own.
  describe("preconditions", () => {
    it("keeps polling a submission a reload interrupted", async () => {
      const [, real] = await scenario(new Submit(0), new Reload());
      expect(real.store.getState().pending.submissions).toHaveLength(1);
    });

    it("puts a just-submitted row in front of the author", async () => {
      const [model] = await scenario(new Submit(0));
      expect(model.everSeen).toContain(uriOf(0));
    });

    it("drops submissions past MAX_AGE_MS from the resumed set", async () => {
      const [, real] = await scenario(new Submit(0), new AdvanceClock(MAX_AGE_MS), new Reload());
      expect(real.store.getState().pending.submissions).toHaveLength(0);
    });
  });

  // Read-your-writes. The only thing that ever put the row on screen was an
  // in-memory tombstone, and a reload wipes the query cache. The poll is
  // re-armed (see the precondition above), but carries no content to rebuild
  // the row from.
  it.fails("shows the author their own submission after a reload", async () => {
    await scenario(new Submit(0), new Reload());
    expect(rowsIn(FEED_KEY).map((r) => r.uri)).toContain(uriOf(0));
  });

  // Monotonic reads. Deleting any *other* observation refetches the feed from a
  // server that doesn't have this record yet, so the row vanishes mid-read.
  it.fails("never removes a row the author has already seen", async () => {
    await scenario(new Submit(0), new RefetchLists());
    expect(rowsIn(FEED_KEY).map((r) => r.uri)).toContain(uriOf(0));
  });

  // `loadPersisted` filters entries past MAX_AGE_MS but never writes the
  // filtered list back, and an all-stale key dispatches nothing — so nothing
  // calls `persist()` and the dead key survives.
  it.fails("clears expired submissions out of localStorage on resume", async () => {
    const [, real] = await scenario(new Submit(0), new AdvanceClock(MAX_AGE_MS), new Reload());
    checkStorageMirror(real);
  });
});
