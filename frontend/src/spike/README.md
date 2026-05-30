# SPIKE: TanStack DB for offline viewer-dependent data

A throwaway proof-of-concept evaluating **TanStack DB** as an answer to a
problem the service-worker cache structurally can't solve: occurrences embed
`viewerHasLiked`, so they're unsafe to cache by URL (the SW would serve user
A's likes to user B on a shared device). Today those routes are denylisted from
the SW cache entirely — which means they don't work offline at all.

This spike caches them in JS instead, **keyed per viewer DID**, persisted to
IndexedDB.

## What it demonstrates

1. **Offline reads of per-user data.** Load a taxon once online; the
   occurrence list (with each row's like state) is persisted to IndexedDB,
   scoped to the viewer DID. Reload offline → the list still renders. The SW
   cache cannot do this safely.
2. **Optimistic likes.** Tapping the heart updates instantly via the live
   query and reconciles with `POST/DELETE /api/likes` in the background. If the
   network call fails, TanStack DB rolls the optimistic change back
   automatically.

## Files

| File | Role |
|------|------|
| `tanstackDb.ts` | Isolated `QueryClient` persisted to IndexedDB (idb-keyval); `getOccurrenceCollection(viewerDid, kingdom, name)` factory; like/unlike `onUpdate` handler |
| `OccurrenceDbSpike.tsx` | Demo route component (`useLiveQuery`, optimistic like toggle, online/offline + cache-reset controls) |

Route: `/spike/:kingdom/:name` (wired in `frontend/src/App.tsx`, marked with a
`SPIKE:` comment).

## How to try it

1. Start the full stack so `/api` and `/oauth` resolve: `process-compose up -D`
   (or `npm run dev` + the Rust backend on :3000), then log in.
2. Visit e.g. `http://localhost:5173/spike/Animalia/Cardinalis%20cardinalis`.
3. With the list loaded, open DevTools → Network → **Offline**, then reload.
   The list renders from IndexedDB. The viewer chip shows whose cache it is.
4. Toggle a like online to see the optimistic update + server sync; toggle one
   offline to watch the automatic rollback.

> Without the backend the route still mounts and lands on the "No occurrences
> cached" empty state (the fetch fails gracefully) — that path is what the
> headless smoke test exercises.

## What this spike does NOT cover (the honest gaps)

- **Pagination** — first page only (`limit=20`). A real integration needs
  `useLiveInfiniteQuery` or cursor merging.
- **Offline writes / replay** — a like made while offline currently rolls back.
  True offline-write queuing needs TanStack Query's persisted-mutations /
  `onlineManager` layer. That's the logical next step if this direction is
  approved.
- **Cache eviction on logout** — same cross-user concern flagged for the SW
  cache: on logout/account-switch we'd clear the per-viewer collections + the
  IndexedDB key.
- **Coexistence with Redux** — this is additive and isolated; it deliberately
  does not touch `feedSlice`/`authSlice` or the existing `useLikeToggle`.

## Bundle cost

The TanStack DB + Query + persister libs add ~weight to the main chunk (build
still succeeds; the existing >500 KB chunk warning is pre-existing and tracked
separately). Worth measuring properly before any real adoption.

## Removing the spike

```
rm -rf frontend/src/spike
# remove the /spike route + import in frontend/src/App.tsx
npm remove @tanstack/react-db @tanstack/db @tanstack/query-db-collection \
  @tanstack/react-query @tanstack/query-persist-client-core \
  @tanstack/query-async-storage-persister idb-keyval
```
