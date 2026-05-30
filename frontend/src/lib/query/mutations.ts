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
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { setOccurrenceLike } from "./occurrenceCache";
import { likeObservation, unlikeObservation } from "../../services/api";

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
