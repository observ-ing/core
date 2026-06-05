// Write mutations with offline-replay support.
//
// Mutation *defaults* (not just hook options) are registered on the shared
// client so that a mutation paused while offline — and persisted to IndexedDB
// across a reload — can be resumed later: TanStack Query only persists a
// mutation's key + variables, then looks up the mutationFn from these defaults
// to replay it. The provider calls resumePausedMutations() after restore.
//
// This module is imported for its side effects by QueryProvider.tsx, which
// guarantees the defaults exist before any mutation runs or resumes.
import { useMutation, type InfiniteData } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import {
  setOccurrenceLike,
  invalidateOccurrenceLists,
  invalidateObservation,
  removeObservation,
} from "./occurrenceCache";
import { qk } from "./keys";
import type { NotificationsResponse } from "../../services/types";
import {
  likeObservation,
  unlikeObservation,
  markNotificationRead,
  updateUserPreferences,
  submitComment,
  submitIdentification,
  submitObservation,
  updateObservation,
  deleteObservation,
  deleteIdentification,
  pollObservation,
} from "../../services/api";
import type { UpdatePreferencesRequest, UserPreferencesResponse } from "../../services/types";

// ── Likes ──────────────────────────────────────────────────────────────────
export const LIKE_MUTATION_KEY = ["like"] as const;

/** `liked` is the DESIRED end state (true = like, false = unlike). */
export type LikeVars = { uri: string; cid: string; liked: boolean };

queryClient.setMutationDefaults(LIKE_MUTATION_KEY, {
  mutationFn: async ({ uri, cid, liked }: LikeVars) =>
    liked ? likeObservation(uri, cid) : unlikeObservation(uri),
  // Optimistically patch every cache holding this occurrence. Runs even while
  // offline (the network call is what pauses, not onMutate).
  onMutate: ({ uri, liked }: LikeVars) => {
    setOccurrenceLike(uri, liked);
  },
  // Revert on a real failure. Paused-offline mutations don't error, so this
  // only fires for genuine server/network errors once online.
  onError: (_err, { uri, liked }: LikeVars) => {
    setOccurrenceLike(uri, !liked);
  },
});

/**
 * Toggle a like. Reads its current state from the rendered occurrence, so the
 * source of truth stays the query cache (no per-component liked state).
 */
export function useLike() {
  return useMutation<unknown, Error, LikeVars>({ mutationKey: LIKE_MUTATION_KEY });
}

// ── Notifications ────────────────────────────────────────────────────────────
/**
 * Mark one notification (by id) or all (no id) read. Optimistically flips
 * `read` in the cache so the unread badge / "Mark all read" button update
 * instantly, then reconciles with the server on settle.
 */
export function useMarkNotificationRead() {
  return useMutation({
    mutationFn: (id?: number) => markNotificationRead(id),
    onMutate: async (id?: number) => {
      await queryClient.cancelQueries({ queryKey: qk.notifications() });
      const previous = queryClient.getQueryData<InfiniteData<NotificationsResponse>>(
        qk.notifications(),
      );
      queryClient.setQueryData<InfiniteData<NotificationsResponse>>(qk.notifications(), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                notifications: page.notifications.map((n) =>
                  id === undefined || n.id === id ? { ...n, read: true } : n,
                ),
              })),
            }
          : data,
      );
      queryClient.setQueryData<{ count: number }>(qk.unreadCount(), (c) =>
        id === undefined ? { count: 0 } : c ? { count: Math.max(0, c.count - 1) } : c,
      );
      return { previous };
    },
    // On success the optimistic state already matches server truth (read=true),
    // so no refetch is needed; a natural refetch on next visit reconciles.
    // Only roll back on a genuine failure.
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(qk.notifications(), context.previous);
    },
  });
}

// ── User preferences ─────────────────────────────────────────────────────────
/** A partial preferences update: omit a field to leave it unchanged, or pass
 * `null` to clear it. */
export type PreferencesPatch = Partial<UpdatePreferencesRequest>;

/**
 * Merge a patch over the current cached prefs into a *full* request. The upsert
 * writes every column, so omitting a field would otherwise clear it — sending
 * the merged full object keeps the other preferences intact.
 */
function mergePrefs(
  patch: PreferencesPatch,
  current: UserPreferencesResponse | undefined,
): UpdatePreferencesRequest {
  return {
    defaultLicense:
      patch.defaultLicense !== undefined ? patch.defaultLicense : (current?.defaultLicense ?? null),
    basemap: patch.basemap !== undefined ? patch.basemap : (current?.basemap ?? null),
  };
}

/**
 * Update one or more preferences with an optimistic cache patch + rollback.
 * Accepts a partial and merges it over the cache so untouched fields persist.
 * No refetch: the server echoes what we send, so the optimistic value already
 * matches server truth on success.
 */
export function useUpdatePreferences() {
  return useMutation({
    mutationFn: (patch: PreferencesPatch) =>
      updateUserPreferences(
        mergePrefs(patch, queryClient.getQueryData<UserPreferencesResponse>(qk.preferences())),
      ),
    onMutate: async (patch: PreferencesPatch) => {
      await queryClient.cancelQueries({ queryKey: qk.preferences() });
      const previous = queryClient.getQueryData<UserPreferencesResponse>(qk.preferences());
      queryClient.setQueryData<UserPreferencesResponse>(
        qk.preferences(),
        mergePrefs(patch, previous),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(qk.preferences(), context.previous);
    },
  });
}

// ── Comments / identifications (refresh the parent observation detail) ───────
export function useSubmitComment() {
  return useMutation({
    mutationFn: submitComment,
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.observation(vars.occurrenceUri) });
    },
  });
}

export function useSubmitIdentification() {
  return useMutation({
    mutationFn: submitIdentification,
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.observation(vars.occurrenceUri) });
    },
  });
}

// ── Observation write path (create / update / delete) ────────────────────────
// These wrap the PDS write plus the post-write ingester-consistency poll the
// components used to do inline, so a settled mutation means the change is
// already visible to the API (no stale row / ghost record) before the caches
// refresh.

/**
 * Create an observation. The PDS write returns immediately; the caller closes
 * the modal and hands the new uri/cid to the `trackSubmission` thunk, which
 * owns the background ingester poll + completion toast + pending indicator. The
 * hook stays a thin wrapper so that lifecycle is unchanged.
 */
export function useSubmitObservation() {
  return useMutation({ mutationFn: submitObservation });
}

/** Edit an observation. Lifecycle mirrors {@link useSubmitObservation}. */
export function useUpdateObservation() {
  return useMutation({ mutationFn: updateObservation });
}

/**
 * Delete an observation: write to the PDS, then wait for the ingester to drop
 * the row (refreshing the feeds before that would briefly show the deleted
 * observation). On success drop the detail cache and refetch every occurrence
 * list so it disappears everywhere — no full-page reload.
 */
export function useDeleteObservation() {
  return useMutation({
    mutationFn: async (uri: string) => {
      await deleteObservation(uri);
      await pollObservation(uri, (r) => !r?.occurrence);
    },
    onSuccess: (_data, uri) => {
      removeObservation(uri);
      void invalidateOccurrenceLists();
    },
  });
}

/**
 * Delete an identification: write to the PDS, then wait for the ingester to
 * remove it from the parent observation (refetching immediately would show the
 * stale row and make the delete look like it failed), then refetch the detail.
 */
export function useDeleteIdentification() {
  return useMutation({
    mutationFn: async ({ uri, occurrenceUri }: { uri: string; occurrenceUri: string }) => {
      await deleteIdentification(uri);
      await pollObservation(
        occurrenceUri,
        (r) => !r?.identifications?.some((id) => id.uri === uri),
      );
    },
    onSuccess: (_data, { occurrenceUri }) => {
      void invalidateObservation(occurrenceUri);
    },
  });
}
