// State simulation of likes in the frontend query cache: the same recipe as
// the tap-ingester sim (docs/system-tests.md), one layer up.
//
// - Source of truth: the like records in the viewer's repo.
// - Expected state: the UI shows what the repo says, plus the viewer's own
//   taps that haven't landed yet.
// - Messy actions: taps in quick succession, refetches (window focus, remount)
//   at any moment, requests answered in any order or failing, and an ingester
//   that lags behind the repo.
// - Check: named properties after every step, and once everything settles.
//
// The backend is a fake that honors the contract the tap-ingester sim proves:
// once the ingester catches up, the API shows what the repo says. So the only
// backend misbehavior modeled is lag. Everything above the API is real: the
// shared QueryClient, the like mutation defaults, and occurrenceCache's
// patching. fast-check generates the action sequences and shrinks failures.
import { describe, it, vi, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import type * as ApiModule from "../../services/api";
import type { OccurrenceDetailResponse } from "../../services/types";

// The api layer is replaced by the fake backend below; the query layer
// imports it after this mock is registered.
vi.mock("../../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  likeObservation: () => backend.request("like"),
  unlikeObservation: () => backend.request("unlike"),
  fetchObservation: () => backend.request("fetch"),
}));

import { fetchObservation } from "../../services/api";
import { queryClient } from "./queryClient";
import { LIKE_MUTATION_KEY, type LikeVars } from "./mutations";
import { makeTombstoneOccurrence } from "./occurrenceCache";
import { qk } from "./keys";

const URI = "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/o1";
const CID = "bafyoccurrence";

const OCCURRENCE = makeTombstoneOccurrence({
  uri: URI,
  cid: CID,
  observer: { did: "did:plc:author" },
  latitude: 37.77,
  longitude: -122.42,
  imageUrls: [],
  createdAt: "2026-01-01T00:00:00Z",
});

type Kind = "like" | "unlike" | "fetch";

interface Request {
  kind: Kind;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * The appview, the ingester, and the viewer's repo, as far as likes go. The
 * test decides when each request is answered and how far the ingester lags.
 */
class FakeBackend {
  /** Source of truth: like records in the viewer's repo. */
  repo = new Set<string>();
  /** What the ingester has applied, which is what the API reads. */
  db = new Set<string>();
  /** Repo commits the ingester hasn't applied yet, oldest first. */
  lag: { add: boolean; uri: string }[] = [];
  pending: Request[] = [];
  private records = 0;

  request(kind: Kind): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => this.pending.push({ kind, resolve, reject }));
  }

  /** Answer the `index`-th pending request (wrapping), succeeding or failing. */
  serve(index: number, ok: boolean): Kind | undefined {
    const [req] = this.pending.splice(index % this.pending.length, 1);
    if (!req) return undefined;
    if (req.kind === "fetch") {
      // fetchObservation catches network errors and returns null.
      req.resolve(ok ? this.detail() : null);
    } else if (!ok) {
      req.reject(new Error("network error"));
    } else if (req.kind === "like") {
      const uri = `at://did:plc:viewer/ing.observ.temp.like/l${++this.records}`;
      this.repo.add(uri);
      this.lag.push({ add: true, uri });
      req.resolve({ uri, cid: "bafylike" });
    } else {
      // The appview's unlike deletes the like records the DB knows about.
      // (It retries for ~1.5s when there are none; lag outlasts that.)
      for (const uri of this.db) {
        this.repo.delete(uri);
        this.lag.push({ add: false, uri });
      }
      req.resolve({ success: true });
    }
    return req.kind;
  }

  ingest(n: number): void {
    for (const commit of this.lag.splice(0, n)) {
      if (commit.add) this.db.add(commit.uri);
      else this.db.delete(commit.uri);
    }
  }

  get liked(): boolean {
    return this.repo.size > 0;
  }

  private detail(): OccurrenceDetailResponse {
    const liked = this.db.size > 0;
    return {
      occurrence: { ...OCCURRENCE, viewerHasLiked: liked, likeCount: liked ? 1 : 0 },
      identifications: [],
      comments: [],
    };
  }
}

let backend = new FakeBackend();

// ── Actions ──────────────────────────────────────────────────────────────────
// Every action is total (a no-op when it can't apply), so fast-check can drop
// any of them while shrinking and still have a valid scenario.

type Action =
  | { type: "tap" }
  | { type: "refetch" }
  | { type: "serve"; n: number; ok: boolean }
  | { type: "ingest"; n: number }
  | { type: "tick" };

function describeAction(a: Action): string {
  switch (a.type) {
    case "tap":
      return "user taps like";
    case "refetch":
      return "detail refetches";
    case "serve":
      return `backend answers request #${a.n}${a.ok ? "" : " with a network error"}`;
    case "ingest":
      return `ingester applies ${a.n} commit(s)`;
    case "tick":
      return "5s pass";
  }
}

const labeled = (a: Action) => Object.assign(a, { [fc.toStringMethod]: () => describeAction(a) });

const action: fc.Arbitrary<Action> = fc
  .oneof(
    { weight: 3, arbitrary: fc.constant<Action>({ type: "tap" }) },
    { weight: 2, arbitrary: fc.constant<Action>({ type: "refetch" }) },
    {
      weight: 5,
      arbitrary: fc.record({
        type: fc.constant("serve" as const),
        n: fc.nat(3),
        ok: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, fc.constant(false)),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        type: fc.constant("ingest" as const),
        n: fc.integer({ min: 1, max: 2 }),
      }),
    },
    { weight: 1, arbitrary: fc.constant<Action>({ type: "tick" }) },
  )
  .map(labeled);

// ── Running a scenario ───────────────────────────────────────────────────────

interface Run {
  observer: QueryObserver<OccurrenceDetailResponse | null>;
  unsubscribe: () => void;
  /** The latest tap: what the viewer last asked for. */
  intent: { liked: boolean; failed: boolean } | undefined;
}

/** Let promise chains and 0ms timers (TanStack's notify batching) run. */
async function flush(): Promise<void> {
  // eslint-disable-next-line no-await-in-loop -- each pass must see the previous one's effects
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

const shown = () => queryClient.getQueryData<OccurrenceDetailResponse | null>(qk.observation(URI));

/** A fresh session with the observation detail page loaded. */
async function open(): Promise<Run> {
  queryClient.clear();
  backend = new FakeBackend();
  // Mirrors useObservation.
  const observer = new QueryObserver<OccurrenceDetailResponse | null>(queryClient, {
    queryKey: qk.observation(URI),
    queryFn: () => fetchObservation(URI),
  });
  const unsubscribe = observer.subscribe(() => {});
  await flush();
  backend.serve(0, true);
  await flush();
  return { observer, unsubscribe, intent: undefined };
}

/** Apply an action; returns what actually happened, for the failure report. */
async function step(run: Run, a: Action): Promise<string | undefined> {
  let happened: string | undefined;
  switch (a.type) {
    case "tap": {
      // The like button reads its state from the cache, like the real one.
      const detail = shown();
      if (!detail) break;
      const intent = { liked: !detail.occurrence.viewerHasLiked, failed: false };
      happened = `user taps ${intent.liked ? "like" : "unlike"}`;
      run.intent = intent;
      new MutationObserver<unknown, Error, LikeVars>(queryClient, {
        mutationKey: LIKE_MUTATION_KEY,
      })
        .mutate({ uri: URI, cid: CID, liked: intent.liked })
        .catch(() => {
          intent.failed = true;
        });
      break;
    }
    case "refetch":
      void run.observer.refetch();
      happened = "detail refetches (e.g. window focus)";
      break;
    case "serve": {
      const kind = backend.pending.length ? backend.serve(a.n, a.ok) : undefined;
      if (kind)
        happened = `backend answers the ${kind === "fetch" ? "refetch" : `${kind} request`}${a.ok ? "" : " with a network error"}`;
      break;
    }
    case "ingest":
      if (backend.lag.length) {
        backend.ingest(a.n);
        happened = `ingester catches up ${a.n} commit(s)`;
      }
      break;
    case "tick":
      await vi.advanceTimersByTimeAsync(5_000);
      happened = "5s pass";
      break;
  }
  await flush();
  return happened;
}

/** Stop the chaos: the ingester keeps up, every request succeeds, retries fire. */
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    backend.ingest(Infinity);
    if (backend.pending.length) {
      backend.serve(0, true);
      // eslint-disable-next-line no-await-in-loop -- settling is sequential: answer, then let the app react
      await flush();
    } else if (queryClient.isMutating() > 0) {
      // eslint-disable-next-line no-await-in-loop -- settling is sequential: answer, then let the app react
      await vi.advanceTimersByTimeAsync(60_000);
    } else {
      break;
    }
  }
  backend.ingest(Infinity);
}

// ── Properties ───────────────────────────────────────────────────────────────

interface Property {
  name: string;
  /** Checked after every step; returns a description of the violation. */
  always?: (run: Run) => string | undefined;
  /** Checked once everything has settled. */
  settled?: (run: Run) => string | undefined;
}

const PROPERTIES: Property[] = [
  {
    name: "keeps_latest_tap",
    // Until the latest tap fails, the UI shows what the viewer asked for.
    always: (run) => {
      const detail = shown();
      if (!detail || !run.intent || run.intent.failed) return;
      if (detail.occurrence.viewerHasLiked !== run.intent.liked)
        return `viewer tapped ${run.intent.liked ? "like" : "unlike"}, UI shows ${detail.occurrence.viewerHasLiked ? "liked" : "not liked"}`;
    },
  },
  {
    name: "settled_ui_matches_repo",
    // Once everything settles, what the UI shows is true: a reload won't flip it.
    settled: () => {
      const detail = shown();
      if (!detail) return;
      if (detail.occurrence.viewerHasLiked !== backend.liked)
        return `UI shows ${detail.occurrence.viewerHasLiked ? "liked" : "not liked"}, repo says ${backend.liked ? "liked" : "not liked"}`;
    },
  },
  {
    name: "like_count_consistent",
    // The viewer is the only liker, so the count follows their like.
    always: () => {
      const occ = shown()?.occurrence;
      if (occ && occ.likeCount !== (occ.viewerHasLiked ? 1 : 0))
        return `viewerHasLiked=${occ.viewerHasLiked} but likeCount=${occ.likeCount}`;
    },
  },
  {
    name: "detail_survives_failed_refetch",
    // A network error on refetch shouldn't blank a page that had loaded.
    always: () => (shown() === null ? "detail cache is null after a refetch" : undefined),
  },
];

/** Run a scenario; on a violation, the story of what happened and what broke. */
async function violation(actions: Action[], property: Property): Promise<string | undefined> {
  const run = await open();
  const story = ["(detail page loaded, not liked)"];
  const report = (v: string) =>
    [...story.map((s, i) => (i === 0 ? s : `${String(i).padStart(2)}. ${s}`)), `=> ${v}`].join(
      "\n    ",
    );
  try {
    for (const a of actions) {
      // eslint-disable-next-line no-await-in-loop -- a scenario's steps run in order
      const happened = await step(run, a);
      if (happened) story.push(happened);
      const v = property.always?.(run);
      if (v) return report(v);
    }
    await settle();
    story.push("(everything settles: ingester catches up, requests succeed)");
    const v = property.always?.(run) ?? property.settled?.(run);
    return v && report(v);
  } finally {
    run.unsubscribe();
  }
}

// ── Known bugs (ratchet) ─────────────────────────────────────────────────────
// Properties violated on main. The test fails on a violation not listed here,
// and on a listed one that no longer reproduces, so each fix removes its entry.
const KNOWN_VIOLATIONS: string[] = [
  // The like mutation (mutations.ts) patches the cache optimistically but
  // never cancels in-flight queries or refetches once it settles, so a detail
  // refetch that races the tap (e.g. window focus) overwrites the like with
  // pre-like data, and nothing reconciles it: tap like → refetch → the
  // refetch lands first → UI shows "not liked" while the repo has the like.
  "keeps_latest_tap",
  // The same overwrite, seen once everything settles. Separately: like, then
  // unlike before the ingester has the like; the appview's unlike finds no
  // record to delete (its ~1.5s retry doesn't outlast the lag), so the UI says
  // "not liked" while the repo still likes it, and it comes back on reload.
  "settled_ui_matches_repo",
  // fetchObservation (services/api.ts) returns null on a network error, the
  // same as a 404, so a failed background refetch replaces a loaded page with
  // "Observation not found".
  "detail_survives_failed_refetch",
];

const SEED = Number(process.env.SIM_SEED ?? 20260929);
const RUNS = Number(process.env.SIM_RUNS ?? 300);

describe("likes state simulation", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  for (const property of PROPERTIES) {
    it(property.name, async () => {
      const details = await fc.check(
        fc.asyncProperty(fc.array(action, { maxLength: 25 }), async (actions) => {
          const v = await violation(actions, property);
          if (v) throw new Error(v);
        }),
        { seed: SEED, numRuns: RUNS },
      );
      const known = KNOWN_VIOLATIONS.includes(property.name);
      if (details.failed) {
        const story = details.errorInstance instanceof Error ? details.errorInstance.message : "";
        const report = `✗ ${property.name} (seed ${SEED})\n    ${story}`;
        console.log(report);
        if (!known) throw new Error(`new violation:\n${report}`);
      } else if (known) {
        throw new Error(`${property.name} no longer reproduces; remove it from KNOWN_VIOLATIONS`);
      }
    });
  }
});
