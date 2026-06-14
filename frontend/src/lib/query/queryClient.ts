// Foundation for the server-state layer. A single QueryClient owns all data
// fetched from the API; Redux keeps only client/UI state.
//
// The cache is in-memory only: it dedups requests, keeps views consistent, and
// powers optimistic writes within a session, but it is NOT persisted to disk.
// A reload always refetches from the server. We deliberately dropped IndexedDB
// persistence — it bought offline reads we don't need, and restoring a stale
// snapshot on every load made fast-moving views (the feed) visibly swap from
// cached → fresh a second after paint.
//
// See ./README.md for the server-vs-client boundary.
import { QueryClient } from "@tanstack/react-query";

const ONE_MINUTE = 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default refetch policy. The feed overrides this (see hooks.ts) to avoid
      // reshuffling its newest-first list under the reader on focus.
      staleTime: ONE_MINUTE,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // networkMode "online" (the default) pauses mutations while offline and
      // resumes them on reconnect within the session.
      retry: 1,
    },
  },
});

/**
 * Wipe all cached server state. Call on logout / account switch so a shared
 * device can never surface the previous viewer's cached, viewer-dependent data
 * (likes, feeds, notifications).
 */
export function clearQueryCache(): void {
  queryClient.clear();
}
