// Wraps the app in TanStack Query with IndexedDB persistence + offline-write
// replay. Mount this INSIDE the Redux <Provider> so query hooks can still read
// UI state (filters, viewer DID) from Redux.
import type { ReactNode } from "react";
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
