# Server-state layer (TanStack Query)

All data fetched from the API lives in a single TanStack Query cache, persisted
to IndexedDB. **Redux keeps only client/UI state.** This is what lets
viewer-dependent data (e.g. occurrences embedding `viewerHasLiked`) be cached
per-user and survive an offline reload — something the service-worker cache
can't do safely, since it keys by URL and is blind to the viewer.

## Why TanStack Query (not TanStack DB)

The original spike used TanStack DB collections. The production layer uses plain
**TanStack Query** because the requirement included **offline-write replay**
(queue a like made offline, replay on reconnect) — a native Query feature
(persisted paused mutations + `resumePausedMutations`). DB collections roll
failed writes back rather than queuing them, and would have sat redundantly on
top of Query anyway. Query alone delivers offline reads, cross-view
consistency, and offline writes with one mental model — and is lighter
(dropping the DB packages reduced the main bundle).

## Files

| File                 | Role                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `queryClient.ts`     | The single `QueryClient` + IndexedDB persister (idb-keyval), week-long gcTime.                                          |
| `QueryProvider.tsx`  | `PersistQueryClientProvider`; restores the cache and resumes offline mutations. Mount inside the Redux `<Provider>`.    |
| `keys.ts`            | Central query-key registry.                                                                                             |
| `hooks.ts`           | One read hook per endpoint (`useFeed`, `useTaxon`, `useObservation`, …).                                                |
| `mutations.ts`       | Write hooks. `useLike` is registered as a mutation _default_ for offline replay; others invalidate on success.          |
| `occurrenceCache.ts` | Patches an occurrence's like state across every cache that holds it (feed/profile/taxon/detail) from a single mutation. |

## Offline-write design (likes)

1. `useLike().mutate({ uri, cid, liked })` — `onMutate` optimistically patches
   every occurrence cache via `setOccurrenceLike` (runs even offline).
2. Offline, the network call is _paused_ (networkMode "online"), not failed, so
   nothing rolls back. The paused mutation is persisted to IndexedDB.
3. On reload, `QueryProvider`'s `onSuccess` calls `resumePausedMutations()`;
   `mutations.ts` registered the like mutation _default_ so the persisted
   mutation can find its `mutationFn` to replay.
4. A genuine server/network error (while online) triggers `onError`, which
   reverts the optimistic patch.

## Server-vs-client boundary

**Moved to Query:** all occurrence feeds (home/explore/profile/taxon),
observation detail, taxon detail/children, taxa search, notifications + unread
count, likes, comments, identifications.

**Stays in Redux (UI/client state):** `uiSlice` (modals, toasts, theme,
geolocation), `feedSlice` (currentTab + filters — the query _inputs_), and the
auth _session_.

## Deliberate exceptions / follow-ups

- **Auth session (`/oauth/me`)** stays in `authSlice`. It's the auth gate read
  by many components, has no offline value (it's a session check), and
  migrating it is high-blast-radius for no benefit.
- **`useObservationsGeoJSON`** hook exists but has no consumer yet (no map view
  calls the geojson endpoint). Ready when a map feature needs it.
- **Offline replay is wired for likes only.** Larger writes (observation
  upload/edit with images, comments, identifications) are online-only; they
  invalidate caches on success.

Done in later passes: cache eviction on logout (`clearQueryCache` in the logout
thunk) and user preferences (`useUserPreferences` / `useUpdatePreferences`;
`defaultLicense` no longer lives in Redux).
