import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import type { RootState, AppDispatch } from "./index";
import { fetchObservation, pollObservation } from "../services/api";
import { reconcileOccurrence } from "../lib/query/occurrenceCache";
import { addToast } from "./uiSlice";

const STORAGE_KEY = "observing-pending-submissions";
// Resumed entries older than this are dropped: the ingester has almost
// certainly processed (or backfilled) the record by then, so there's nothing
// useful left to poll for — only a stale spinner.
const MAX_AGE_MS = 2 * 60 * 1000;

interface PendingSubmission {
  uri: string;
  cid: string;
  kind: "create" | "update";
  createdAt: number;
}

interface PendingState {
  submissions: PendingSubmission[];
}

const initialState: PendingState = {
  submissions: [],
};

function loadPersisted(): PendingSubmission[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (s): s is PendingSubmission =>
        s &&
        typeof s.uri === "string" &&
        typeof s.cid === "string" &&
        (s.kind === "create" || s.kind === "update") &&
        typeof s.createdAt === "number" &&
        now - s.createdAt < MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

function persist(submissions: PendingSubmission[]) {
  if (typeof window === "undefined") return;
  try {
    if (submissions.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
  } catch {
    // Best-effort: a full or blocked localStorage must never break a submission.
  }
}

// Poll the ingester for a freshly written observation in the background, then
// notify on completion. The upload modal closes as soon as the PDS write
// returns; a client-built tombstone row (added by the modal on success) stands
// in for the record in the feeds until this poll confirms ingestion.
//
// Once the ingester has the canonical record we fetch it and `reconcileOccurrence`
// swaps it in for the tombstone in-place — no full feed refetch, so the feed's
// no-reorder behavior is preserved. On ingester timeout we leave the optimistic
// row as-is; it reconciles on the next natural refresh.
//
// pollObservation never throws (network errors resolve to a missed predicate),
// so this thunk fulfils even on ingester timeout — `processed` just reports
// whether the row showed up in time. `createdAt` is optional so resumed
// submissions can preserve their original timestamp (and keep aging out).
export const trackSubmission = createAsyncThunk<
  void,
  { uri: string; cid: string; kind: "create" | "update"; createdAt?: number },
  { state: RootState; dispatch: AppDispatch }
>("pending/trackSubmission", async ({ uri, cid, kind }, { dispatch }) => {
  const processed = await pollObservation(uri, (r) => r?.occurrence?.cid === cid);

  // Replace the tombstone (or a pre-edit row) with the canonical record now that
  // the ingester has the matching cid. Both create and update benefit: the
  // freshly-resolved taxonomy and real blob URLs land without a feed refetch.
  if (processed) {
    const detail = await fetchObservation(uri);
    if (detail) reconcileOccurrence(detail);
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
});

// Re-arm any submissions that were still pending when the page was last
// unloaded. Each resumes the same poll against its stable uri/cid, so the
// indicator reappears and the lists still refresh once the ingester catches up.
export const resumePendingSubmissions = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>("pending/resume", async (_, { dispatch }) => {
  for (const entry of loadPersisted()) {
    void dispatch(trackSubmission(entry));
  }
});

// In-flight submissions are keyed by their stable atproto `uri`, so the
// pending / settled lifecycle of trackSubmission is the single source of truth
// for both the indicator and the persisted localStorage mirror.
const pendingSlice = createSlice({
  name: "pending",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(trackSubmission.pending, (state, action) => {
        const { uri, cid, kind, createdAt } = action.meta.arg;
        const entry: PendingSubmission = { uri, cid, kind, createdAt: createdAt ?? Date.now() };
        const existing = state.submissions.findIndex((s) => s.uri === uri);
        if (existing >= 0) state.submissions[existing] = entry;
        else state.submissions.push(entry);
        persist(state.submissions);
      })
      .addCase(trackSubmission.fulfilled, (state, action) => {
        state.submissions = state.submissions.filter((s) => s.uri !== action.meta.arg.uri);
        persist(state.submissions);
      })
      .addCase(trackSubmission.rejected, (state, action) => {
        state.submissions = state.submissions.filter((s) => s.uri !== action.meta.arg.uri);
        persist(state.submissions);
      });
  },
});

export default pendingSlice.reducer;

// Read patterns for the in-flight set live with the slice so the navbar
// indicator and the per-row tombstone styling share one definition of
// "pending" — keyed by the same stable atproto `uri`.

/** Number of submissions still being ingested (drives the TopBar indicator). */
export const selectPendingCount = (state: RootState): number => state.pending.submissions.length;

/** Selector: is the observation at `uri` a still-processing submission? */
export const selectIsPending =
  (uri: string) =>
  (state: RootState): boolean =>
    state.pending.submissions.some((s) => s.uri === uri);

/**
 * Whether `uri` is a freshly-submitted observation the ingester hasn't
 * confirmed yet — the tombstone rows render dimmed while this is true.
 * Returns a primitive, so the subscription stays cheap and churn-free.
 */
export function useIsPending(uri: string): boolean {
  return useSelector(selectIsPending(uri));
}
