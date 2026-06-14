# Server-state layer (TanStack Query)

All data fetched from the API lives in a single **in-memory** TanStack Query
cache. **Redux keeps only client/UI state.** The cache dedups requests, keeps
views consistent (one like patches the feed, profile, taxon, and detail caches
at once), and powers optimistic writes — but it is not persisted to disk, so a
reload always refetches from the server.

## Why in-memory only (no IndexedDB persistence)

This layer originally persisted the cache to IndexedDB for offline reads +
offline-write replay. We removed that: offline isn't a product requirement, and
restoring a stale snapshot on every load made fast-moving views — chiefly the
newest-first feed — visibly swap from cached → fresh a second after paint. An
in-memory cache keeps the wins that matter (dedup, cross-view consistency,
optimistic likes) without the stale-on-load swap, and drops the persist packages
from the bundle. A like tapped offline still pauses and resumes on reconnect
_within a session_ (networkMode "online"); it just isn't replayed across a
reload.

## Why TanStack Query (not TanStack DB)

The original spike used TanStack DB collections. The production layer uses plain
**TanStack Query** for dedup, cross-view consistency, pagination, and optimistic
writes under one mental model — lighter than DB collections sitting on top of
Query, and DB rolls failed writes back rather than pausing/resuming them.

## Files

| File                 | Role                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `queryClient.ts`     | The single in-memory `QueryClient` and its default refetch policy.                                                      |
| `QueryProvider.tsx`  | `QueryClientProvider`. Mount inside the Redux `<Provider>`.                                                             |
| `keys.ts`            | Central query-key registry.                                                                                             |
| `hooks.ts`           | One read hook per endpoint (`useFeed`, `useTaxon`, `useObservation`, …).                                                |
| `mutations.ts`       | Write hooks. `useLike` is registered as a mutation _default_ (optimistic, in one place); others invalidate on success.  |
| `occurrenceCache.ts` | Patches an occurrence's like state across every cache that holds it (feed/profile/taxon/detail) from a single mutation. |

## Optimistic-write design (likes)

1. `useLike().mutate({ uri, cid, liked })` — `onMutate` optimistically patches
   every occurrence cache via `setOccurrenceLike` (runs even offline).
2. Offline, the network call is _paused_ (networkMode "online"), not failed, so
   nothing rolls back. It resumes automatically on reconnect within the session.
   (The cache is in-memory, so a paused like does not survive a reload.)
3. A genuine server/network error (while online) triggers `onError`, which
   reverts the optimistic patch.

## Server-vs-client boundary

**Moved to Query:** all occurrence feeds (home/explore/profile/taxon),
observation detail, taxon detail/children, taxa search, notifications + unread
count, likes, comments, identifications.

**Stays in Redux (UI/client state):** `uiSlice` (modals, toasts, theme,
geolocation), `feedSlice` (explore filters — a query _input_ shared with the
filter panel; the active tab is the route, read from the `tab` prop), and the
auth _session_.

## Deliberate exceptions / follow-ups

- **Auth session (`/oauth/me`)** stays in `authSlice`. It's the auth gate read
  by many components, has no offline value (it's a session check), and
  migrating it is high-blast-radius for no benefit.
- **`useObservationsGeoJSON`** hook exists but has no consumer yet (no map view
  calls the geojson endpoint). Ready when a map feature needs it.
- **Optimistic patching is wired for likes only.** Larger writes (observation
  upload/edit with images, comments, identifications) invalidate caches on
  success rather than patching optimistically.

Done in later passes: cache eviction on logout (`clearQueryCache` in the logout
thunk) and user preferences (`useUserPreferences` / `useUpdatePreferences`;
`defaultLicense` no longer lives in Redux).
