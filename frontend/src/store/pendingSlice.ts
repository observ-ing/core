import {
  createSlice,
  createAsyncThunk,
  createSelector,
  type PayloadAction,
} from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import type { RootState, AppDispatch } from "./index";
import { fetchObservation, pollObservation, INGEST_POLL_WINDOW_MS } from "../services/api";
import { prependOccurrence, reconcileOccurrence } from "../lib/query/occurrenceCache";
import type { Occurrence } from "../services/types";
import { addToast } from "./uiSlice";
import { logout } from "./authSlice";

const STORAGE_KEY = "observing-pending-submissions";
const TOMBSTONE_STORAGE_KEY = "observing-pending-tombstones";

// How long a persisted entry stays worth keeping across reloads. It is
// deliberately a multiple of the active poll window rather than an independent
// guess: a submission whose poll gave up (INGEST_POLL_WINDOW_MS) is still worth
// showing and re-arming for a while, because ingest lag is unbounded — there is
// no SLA on relay → Tap → tap-ingester, only observed latency. Four windows is
// long enough to cover a slow-but-normal ingest and short enough that a genuinely
// stuck record doesn't leave a permanent ghost row. Past it we give up: the
// record has almost certainly been ingested (or backfilled), so the server's own
// answer is better than ours.
export const MAX_AGE_MS = 4 * INGEST_POLL_WINDOW_MS;

interface PendingSubmission {
  uri: string;
  cid: string;
  kind: "create" | "update";
  createdAt: number;
}

/**
 * A client-built row standing in for a submission the API can't serve yet.
 *
 * These are kept here rather than spliced into the query caches: cached pages
 * are replaced wholesale by any refetch and dropped entirely by a reload, so a
 * row that lives inside them cannot survive either. Kept in the store and merged
 * at select time (see `mergePendingOccurrences`), the row is immune to both.
 */
interface PendingTombstone {
  uri: string;
  createdAt: number;
  occurrence: Occurrence;
}

interface PendingState {
  /** Submissions with an ingester poll in flight — drives the TopBar indicator. */
  submissions: PendingSubmission[];
  /** Optimistic rows the server hasn't confirmed yet — merged into the feeds. */
  tombstones: PendingTombstone[];
}

const initialState: PendingState = {
  submissions: [],
  tombstones: [],
};

/**
 * Read one persisted list, dropping entries past `MAX_AGE_MS`.
 *
 * The filtered result is written back when it differs from what was read:
 * otherwise an entirely-stale key is filtered on every load but never rewritten
 * (nothing downstream dispatches, so nothing calls `persist`) and survives
 * forever.
 */
function loadPersisted<T extends { createdAt: number }>(
  key: string,
  isValid: (value: unknown) => value is T,
): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(key);
      return [];
    }
    const now = Date.now();
    const fresh = parsed.filter((s): s is T => isValid(s) && now - s.createdAt < MAX_AGE_MS);
    if (fresh.length !== parsed.length) persist(key, fresh);
    return fresh;
  } catch {
    return [];
  }
}

function persist(key: string, entries: unknown[]) {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Best-effort: a full or blocked localStorage must never break a submission.
  }
}

// Storage is user-writable and survives schema changes, so every field a
// resumed entry is used for is checked before it is trusted.
function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isSubmission(value: unknown): value is PendingSubmission {
  if (!isRecord(value)) return false;
  if (!("uri" in value) || typeof value.uri !== "string") return false;
  if (!("cid" in value) || typeof value.cid !== "string") return false;
  if (!("createdAt" in value) || typeof value.createdAt !== "number") return false;
  return "kind" in value && (value.kind === "create" || value.kind === "update");
}

function isTombstone(value: unknown): value is PendingTombstone {
  if (!isRecord(value)) return false;
  if (!("uri" in value) || typeof value.uri !== "string") return false;
  if (!("createdAt" in value) || typeof value.createdAt !== "number") return false;
  if (!("occurrence" in value) || !isRecord(value.occurrence)) return false;
  const { occurrence } = value;
  return (
    "uri" in occurrence &&
    typeof occurrence.uri === "string" &&
    "images" in occurrence &&
    Array.isArray(occurrence.images)
  );
}

// The uploader's own previews are `data:` URLs holding the full image bytes —
// megabytes each, against a ~5MB localStorage budget shared with everything
// else. They're dropped on the way to storage; a resumed row renders without a
// photo until the canonical record arrives with the real blob URLs.
function withoutInlinePreviews(entry: PendingTombstone): PendingTombstone {
  const images = entry.occurrence.images.filter(
    (img) => !img.url.startsWith("data:") && !img.url.startsWith("blob:"),
  );
  if (images.length === entry.occurrence.images.length) return entry;
  return { ...entry, occurrence: { ...entry.occurrence, images } };
}

function persistTombstones(entries: PendingTombstone[]) {
  persist(TOMBSTONE_STORAGE_KEY, entries.map(withoutInlinePreviews));
}

// Poll the ingester for a freshly written observation in the background, then
// notify on completion. The upload modal closes as soon as the PDS write
// returns; the tombstone row this thunk carries (built by the modal) stands in
// for the record in the feeds until the poll confirms ingestion.
//
// Once the ingester has the canonical record we fetch it, `reconcileOccurrence`
// replaces any copy already in a cache and `prependOccurrence` inserts it where
// there was none — so the canonical row is in place *before* the fulfilled
// reducer drops the tombstone, and the swap never leaves a gap. No full feed
// refetch, so the feed's no-reorder behavior is preserved.
//
// On ingester timeout the tombstone deliberately survives (the record is still
// coming; only our patience ran out) and ages out with `MAX_AGE_MS`.
//
// pollObservation never throws (network errors resolve to a missed predicate),
// so this thunk fulfils even on ingester timeout — the resolved value reports
// whether the row showed up in time. `createdAt` is optional so resumed
// submissions can preserve their original timestamp (and keep aging out).
export const trackSubmission = createAsyncThunk<
  boolean,
  {
    uri: string;
    cid: string;
    kind: "create" | "update";
    createdAt?: number;
    /** The optimistic row to show until the ingester catches up (creates only). */
    occurrence?: Occurrence;
  },
  { state: RootState; dispatch: AppDispatch }
>("pending/trackSubmission", async ({ uri, cid, kind }, { dispatch, getState }) => {
  const processed = await pollObservation(uri, (r) => r?.occurrence?.cid === cid);

  // Swap in the canonical record now that the ingester has the matching cid.
  // Both create and update benefit: the freshly-resolved taxonomy and real blob
  // URLs land without a feed refetch.
  if (processed) {
    const detail = await fetchObservation(uri);
    if (detail) {
      reconcileOccurrence(detail);
      // A create has no canonical row in the caches yet — only the tombstone
      // this thunk is about to retire — so seed one. `prependOccurrence` is a
      // no-op wherever the row already exists. Skipped if the tombstone is
      // already gone: the observation was deleted while we were polling, and
      // inserting it now would resurrect it as a ghost row.
      const stillPending = getState().pending.tombstones.some((t) => t.uri === uri);
      if (kind === "create" && stillPending) {
        prependOccurrence(detail.occurrence, detail.occurrence.observer.did);
      }
    }
  }

  if (kind === "update") {
    dispatch(addToast({ message: "Observation updated successfully!", type: "success" }));
  } else {
    dispatch(
      addToast({
        message: processed
          ? "Observation submitted successfully!"
          : "Observation submitted! It may take a moment to appear.",
        type: "success",
      }),
    );
  }

  return processed;
});

// Re-arm any submissions that were still pending when the page was last
// unloaded, and restore the optimistic rows that went with them. Each poll
// resumes against its stable uri/cid, so the indicator reappears and the row
// reconciles once the ingester catches up.
//
// Tombstones are restored first, and separately: a submission whose poll had
// already timed out before the reload keeps its row (there is nothing left to
// poll for, but the record is still coming) while contributing no spinner.
export const resumePendingSubmissions = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>("pending/resume", async (_, { dispatch }) => {
  dispatch(hydrateTombstones(loadPersisted(TOMBSTONE_STORAGE_KEY, isTombstone)));
  for (const entry of loadPersisted(STORAGE_KEY, isSubmission)) {
    void dispatch(trackSubmission(entry));
  }
});

// In-flight submissions and their optimistic rows are keyed by the stable
// atproto `uri`, so the pending / settled lifecycle of trackSubmission is the
// single source of truth for the indicator, the row, and both localStorage
// mirrors.
const pendingSlice = createSlice({
  name: "pending",
  initialState,
  reducers: {
    /** Restore optimistic rows from localStorage after a reload. */
    hydrateTombstones: (state, action: PayloadAction<PendingTombstone[]>) => {
      const restored = action.payload.filter((t) => !state.tombstones.some((s) => s.uri === t.uri));
      state.tombstones.push(...restored);
      persistTombstones(state.tombstones);
    },
    /**
     * Forget an optimistic row without waiting for the ingester — the record it
     * stood for is gone (deleted), so nothing will ever reconcile it.
     */
    dropTombstone: (state, action: PayloadAction<string>) => {
      state.tombstones = state.tombstones.filter((t) => t.uri !== action.payload);
      persistTombstones(state.tombstones);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(trackSubmission.pending, (state, action) => {
        const { uri, cid, kind, createdAt, occurrence } = action.meta.arg;
        const at = createdAt ?? Date.now();
        const entry: PendingSubmission = { uri, cid, kind, createdAt: at };
        const existing = state.submissions.findIndex((s) => s.uri === uri);
        if (existing >= 0) state.submissions[existing] = entry;
        else state.submissions.push(entry);
        persist(STORAGE_KEY, state.submissions);

        if (occurrence) {
          const tombstone: PendingTombstone = { uri, createdAt: at, occurrence };
          const held = state.tombstones.findIndex((t) => t.uri === uri);
          if (held >= 0) state.tombstones[held] = tombstone;
          else state.tombstones.push(tombstone);
          persistTombstones(state.tombstones);
        }
      })
      .addCase(trackSubmission.fulfilled, (state, action) => {
        state.submissions = state.submissions.filter((s) => s.uri !== action.meta.arg.uri);
        persist(STORAGE_KEY, state.submissions);

        // Only a successful poll retires the row: the thunk has already put the
        // canonical record in the caches. A timeout leaves it standing.
        if (action.payload) {
          state.tombstones = state.tombstones.filter((t) => t.uri !== action.meta.arg.uri);
          persistTombstones(state.tombstones);
        }
      })
      .addCase(trackSubmission.rejected, (state, action) => {
        // The poll itself failed, not the write — the record is still on the
        // PDS and still coming, so the row stays and ages out.
        state.submissions = state.submissions.filter((s) => s.uri !== action.meta.arg.uri);
        persist(STORAGE_KEY, state.submissions);
      })
      .addCase(logout.fulfilled, (state) => {
        // Both lists are the departing viewer's own in-flight writes, and both
        // outlive the page. Drop them for the same reason logout drops the query
        // cache: the next viewer on this device must not inherit them.
        state.submissions = [];
        state.tombstones = [];
        persist(STORAGE_KEY, []);
        persist(TOMBSTONE_STORAGE_KEY, []);
      });
  },
});

export const { hydrateTombstones, dropTombstone } = pendingSlice.actions;
export default pendingSlice.reducer;

// Read patterns for the in-flight set live with the slice so the navbar
// indicator, the per-row tombstone styling and the feed overlay share one
// definition of "pending" — keyed by the same stable atproto `uri`.

/** Number of submissions still being ingested (drives the TopBar indicator). */
export const selectPendingCount = (state: RootState): number => state.pending.submissions.length;

/** Selector: is the observation at `uri` a still-processing submission? */
export const selectIsPending =
  (uri: string) =>
  (state: RootState): boolean =>
    state.pending.submissions.some((s) => s.uri === uri) ||
    state.pending.tombstones.some((t) => t.uri === uri);

/**
 * The optimistic rows to merge into the author's own feeds, newest first —
 * matching the newest-first order of the lists they're spliced into.
 *
 * Memoized: the feed hooks pass this straight to a `select`, so an unstable
 * reference would re-derive (and re-render) the feed on every dispatched action.
 */
export const selectPendingOccurrences: (state: RootState) => Occurrence[] = createSelector(
  [(state: RootState) => state.pending.tombstones],
  (tombstones) =>
    [...tombstones].sort((a, b) => b.createdAt - a.createdAt).map((t) => t.occurrence),
);

/**
 * Whether `uri` is a submission the API hasn't confirmed yet — either an
 * ingester poll is still running or the row on screen is one we built. The
 * tombstone rows render dimmed while this is true. Returns a primitive, so the
 * subscription stays cheap and churn-free.
 */
export function useIsPending(uri: string): boolean {
  return useSelector(selectIsPending(uri));
}
