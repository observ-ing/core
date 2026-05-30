// ─────────────────────────────────────────────────────────────────────────
// SPIKE: TanStack DB against the viewer-dependent /occurrences route.
//
// This is a throwaway proof-of-concept, NOT production wiring. It exists to
// demonstrate one thing the service-worker cache structurally cannot do
// safely: persist *viewer-dependent* data (occurrences embed
// `viewerHasLiked`) for offline reads, keyed per-user, with optimistic
// like/unlike mutations.
//
// How it works:
//   - A standalone QueryClient (NOT a global <QueryClientProvider>) backs a
//     TanStack DB "query collection". We keep it isolated so the spike can't
//     perturb the rest of the app.
//   - The QueryClient cache is persisted to IndexedDB via idb-keyval. On
//     reload — including offline reload — the cache is restored and the
//     collection renders from it. The persisted key includes the viewer DID,
//     so user A can never be served user B's cached likes.
//   - Likes go through the collection's `onUpdate` handler, which calls the
//     existing REST endpoints. Optimistic state is applied instantly and
//     rolled back automatically if the network call fails.
//
// Cleanup: delete the `frontend/src/spike/` folder and the `/spike` route in
// App.tsx, then `npm remove @tanstack/react-db @tanstack/db
// @tanstack/query-db-collection @tanstack/react-query
// @tanstack/query-persist-client-core @tanstack/query-async-storage-persister
// idb-keyval`.
// ─────────────────────────────────────────────────────────────────────────
import { QueryClient } from "@tanstack/react-query";
import { createCollection, type Collection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/query-persist-client-core";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import { fetchTaxonObservations, likeObservation, unlikeObservation } from "../services/api";
import type { Occurrence } from "../services/types";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Isolated client. Long gcTime so cached occurrences survive in memory; the
// IndexedDB persister is what survives a reload/offline restart.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: ONE_WEEK_MS,
      staleTime: 60 * 1000,
      retry: false,
    },
  },
});

// idb-keyval exposes get/set/del; adapt it to the AsyncStorage shape the
// persister expects (getItem returns null, not undefined, when absent).
const PERSIST_KEY = "obsv-tanstack-db-spike";
const persister = createAsyncStoragePersister({
  key: PERSIST_KEY,
  storage: {
    getItem: async (k) => (await get(k)) ?? null,
    setItem: async (k, v) => set(k, v),
    removeItem: async (k) => del(k),
  },
});

let restorePromise: Promise<void> | null = null;

/**
 * Restore the persisted query cache from IndexedDB exactly once, then keep it
 * in sync. Must resolve before any collection is created so offline reads hit
 * the restored cache instead of firing a (failing) network request.
 */
export function restoreQueryClient(): Promise<void> {
  if (!restorePromise) {
    restorePromise = persistQueryClientRestore({
      queryClient,
      persister,
      maxAge: ONE_WEEK_MS,
    }).then(() => {
      persistQueryClientSubscribe({ queryClient, persister });
    });
  }
  return restorePromise;
}

/** Wipe the persisted spike cache (for the "reset" button in the demo). */
export async function clearSpikeCache(): Promise<void> {
  queryClient.clear();
  await del(PERSIST_KEY);
}

export type OccurrenceCollection = Collection<Occurrence, string>;

const collections = new Map<string, OccurrenceCollection>();

/**
 * Get (or lazily create) the occurrence collection for a given viewer + taxon.
 *
 * The viewer DID is part of BOTH the collection id and the query key — this is
 * the crux of why this is safe where URL-keyed SW caching is not: every cache
 * entry is scoped to the authenticated viewer, so `viewerHasLiked` can never
 * leak across accounts on a shared device.
 */
export function getOccurrenceCollection(
  viewerDid: string,
  kingdom: string,
  name: string,
): OccurrenceCollection {
  const cacheKey = `${viewerDid}::${kingdom}::${name}`;
  const existing = collections.get(cacheKey);
  if (existing) return existing;

  const collection = createCollection(
    queryCollectionOptions<Occurrence, unknown, ReadonlyArray<unknown>, string>({
      id: `occurrences:${cacheKey}`,
      queryClient,
      queryKey: ["spike", "occurrences", viewerDid, kingdom, name],
      // First page only — pagination is out of scope for the spike.
      queryFn: async () => {
        const { occurrences } = await fetchTaxonObservations(kingdom, name);
        return occurrences;
      },
      getKey: (occ) => occ.uri,
      // Like / unlike. Optimistic state is already applied by collection.update;
      // here we just reconcile with the server. A throw triggers rollback.
      onUpdate: async ({ transaction }) => {
        for (const m of transaction.mutations) {
          const occ = m.original;
          if ("viewerHasLiked" in m.changes) {
            if (m.changes.viewerHasLiked) {
              await likeObservation(occ.uri, occ.cid);
            } else {
              await unlikeObservation(occ.uri);
            }
          }
        }
      },
    }),
  );

  collections.set(cacheKey, collection);
  return collection;
}
