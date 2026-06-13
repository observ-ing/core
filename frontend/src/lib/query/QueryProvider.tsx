// Wraps the app in TanStack Query with IndexedDB persistence + offline-write
// replay. Mount this INSIDE the Redux <Provider> so query hooks can still read
// UI state (filters, viewer DID) from Redux.
import type { ReactNode } from "react";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, persister, PERSIST_MAX_AGE } from "./queryClient";
// Side-effect import: registers write-mutation defaults (e.g. likes) on the
// shared client so persisted offline mutations can be resumed below.
import "./mutations";

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        // Persist paused (offline) mutations too, plus successful queries, so a
        // like tapped offline is replayed after a reload + reconnect.
        dehydrateOptions: {
          shouldDehydrateMutation: (mutation) => mutation.state.isPaused,
          // Persist successful queries by default, but NOT the home/explore feed.
          // The feed is fast-moving, newest-first, online-only content: a restored
          // snapshot has no real offline value and is almost always older than its
          // 1-min staleTime, so it renders instantly on load and then visibly
          // swaps when the background refetch returns fresher results. Skipping
          // dehydration makes the feed start clean (one skeleton → content) instead
          // of flashing stale → fresh. Detail caches (observations, taxa) still persist.
          shouldDehydrateQuery: (query) =>
            query.queryKey[0] !== "feed" && defaultShouldDehydrateQuery(query),
        },
        // Bump when cached shapes change incompatibly to discard stale caches.
        buster: "v1",
      }}
      // Fires once the persisted cache has been restored. Resume any mutations
      // that were paused offline in a previous session.
      onSuccess={() => {
        void queryClient.resumePausedMutations();
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
