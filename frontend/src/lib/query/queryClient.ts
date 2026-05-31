// Foundation for the server-state layer. A single QueryClient owns all data
// fetched from the API; Redux keeps only client/UI state. The cache is
// persisted to IndexedDB so viewer-dependent data (which the service worker
// cannot safely cache by URL) survives an offline reload, and write mutations
// made offline are queued and replayed on reconnect.
//
// See ./README.md for the server-vs-client boundary and the offline-write
// design.
import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";

const ONE_MINUTE = 60 * 1000;
export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 1 week
const PERSIST_KEY = "obsv-query-cache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Long gcTime so entries persist long enough to be dehydrated to IDB and
      // restored offline; staleTime keeps the UI from refetching on every mount.
      gcTime: PERSIST_MAX_AGE,
      staleTime: ONE_MINUTE,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // networkMode "online" (the default) pauses mutations while offline; the
      // provider resumes them after the cache is restored / on reconnect.
      retry: 1,
    },
  },
});

// idb-keyval (get/set/del) adapted to the AsyncStorage shape the persister
// wants. getItem must return null (not undefined) when a key is absent.
export const persister = createAsyncStoragePersister({
  key: PERSIST_KEY,
  storage: {
    getItem: async (k) => (await get(k)) ?? null,
    setItem: async (k, v) => set(k, v),
    removeItem: async (k) => del(k),
  },
});

/**
 * Wipe all cached server state — in-memory and the persisted IndexedDB blob.
 * Call on logout / account switch so a shared device can never surface the
 * previous viewer's cached, viewer-dependent data (likes, feeds, notifications).
 */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  try {
    await del(PERSIST_KEY);
  } catch {
    // IndexedDB may be unavailable (private browsing, test env). The in-memory
    // clear above is the critical part; never let this block logout.
  }
}
