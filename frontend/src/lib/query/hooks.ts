// Read hooks — one per server endpoint. Components call these instead of
// fetching into useState/Redux; caching, dedup, offline persistence, and
// refetch-on-focus come from the shared QueryClient.
import { useInfiniteQuery, useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAppSelector } from "../../store";
import { qk } from "./keys";
import {
  fetchHomeFeed,
  fetchExploreFeed,
  fetchProfileFeed,
  fetchTaxonObservations,
  fetchObservation,
  fetchTaxon,
  fetchTaxonChildren,
  searchTaxa,
  validateTaxon,
  fetchObservationsGeoJSON,
  fetchNotifications,
  fetchUnreadCount,
  fetchUserPreferences,
} from "../../services/api";
import type { FeedFilters, FeedTab } from "../../services/types";

type Cursor = string | undefined;
const initialCursor: Cursor = undefined;
const nextCursor = (last: { cursor?: string }): Cursor => last.cursor ?? undefined;

// ── Occurrence feeds (infinite) ──────────────────────────────────────────────

/**
 * Home/explore feed. The active tab comes from the route (passed by the
 * caller); filters + auth are read from Redux. All form the query key.
 *
 * `isAuthenticated` drives the endpoint choice (signed-in home vs. explore
 * fallback) AND is part of the query key, so the two responses never share a
 * cache entry and an auth flip refetches. We also wait for the startup auth
 * check (`isLoading`) to settle before fetching: otherwise the home tab would
 * fire an explore request during the brief window where a logged-in user still
 * reads as unauthenticated, cache it under the home key, and — since auth isn't
 * a refetch trigger on its own — leave the wrong feed showing until the next
 * stale refetch.
 */
export function useFeed(tab: FeedTab) {
  const filters = useAppSelector((s) => s.feed.filters);
  const isAuthenticated = useAppSelector((s) => s.auth.user !== null);
  const authResolved = useAppSelector((s) => !s.auth.isLoading);

  return useInfiniteQuery({
    queryKey: qk.feed(tab, filters, isAuthenticated),
    queryFn: ({ pageParam }: { pageParam: Cursor }) =>
      tab === "home" && isAuthenticated
        ? fetchHomeFeed(pageParam)
        : fetchExploreFeed(pageParam, filters),
    initialPageParam: initialCursor,
    getNextPageParam: nextCursor,
    enabled: authResolved,
    // The feed is an infinite, newest-first list. A background refetch re-pulls
    // every loaded page and can reorder/duplicate rows under the reader, so we
    // don't auto-refresh it on tab focus and give it a longer staleTime so
    // re-entering the feed mid-session doesn't swap content. A real reload (or a
    // future pull-to-refresh) still fetches fresh.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProfileFeed(did: string, type: "observations" | "identifications") {
  return useInfiniteQuery({
    queryKey: qk.profileFeed(did, type),
    queryFn: ({ pageParam }: { pageParam: Cursor }) => fetchProfileFeed(did, pageParam, type),
    initialPageParam: initialCursor,
    getNextPageParam: nextCursor,
    enabled: !!did,
  });
}

export function useTaxonOccurrences(kingdomOrId: string, name?: string) {
  return useInfiniteQuery({
    queryKey: qk.taxonOccurrences(kingdomOrId, name),
    queryFn: ({ pageParam }: { pageParam: Cursor }) =>
      fetchTaxonObservations(kingdomOrId, name, pageParam),
    initialPageParam: initialCursor,
    getNextPageParam: nextCursor,
    enabled: !!kingdomOrId,
    placeholderData: keepPreviousData,
  });
}

// ── Single reads ─────────────────────────────────────────────────────────────

export function useObservation(uri: string | undefined) {
  return useQuery({
    queryKey: qk.observation(uri ?? ""),
    queryFn: () => fetchObservation(uri ?? ""),
    enabled: !!uri,
  });
}

export function useTaxon(kingdomOrId: string | undefined, name?: string) {
  return useQuery({
    queryKey: qk.taxon(kingdomOrId ?? "", name),
    queryFn: () => fetchTaxon(kingdomOrId ?? "", name),
    enabled: !!kingdomOrId,
    // Keep the prior taxon's detail visible while navigating to a new one,
    // matching the old atomic-swap behavior instead of flashing a skeleton.
    placeholderData: keepPreviousData,
  });
}

export function useTaxonChildren(kingdom: string, name: string, enabled = true) {
  return useQuery({
    queryKey: qk.taxonChildren(kingdom, name),
    queryFn: () => fetchTaxonChildren(kingdom, name),
    enabled: enabled && !!kingdom && !!name,
  });
}

/** Taxa search. Disabled below 2 chars to match the old debounced behavior. */
export function useTaxaSearch(query: string) {
  return useQuery({
    queryKey: qk.taxaSearch(query),
    queryFn: () => searchTaxa(query),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function useValidateTaxon(name: string, kingdom?: string, enabled = true) {
  return useQuery({
    queryKey: qk.validateTaxon(name, kingdom),
    queryFn: ({ signal }) => validateTaxon(name, kingdom, signal),
    enabled: enabled && !!name,
  });
}

export function useObservationsGeoJSON(bounds: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}) {
  return useQuery({
    queryKey: qk.geojson(bounds),
    queryFn: () => fetchObservationsGeoJSON(bounds),
  });
}

// ── Notifications + preferences ──────────────────────────────────────────────

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: qk.notifications(),
    queryFn: ({ pageParam }: { pageParam: Cursor }) => fetchNotifications(pageParam),
    initialPageParam: initialCursor,
    getNextPageParam: nextCursor,
  });
}

/** Unread badge count. Polls every 30s while a user is signed in. */
export function useUnreadCount() {
  const isAuthenticated = useAppSelector((s) => s.auth.user !== null);
  return useQuery({
    queryKey: qk.unreadCount(),
    queryFn: fetchUnreadCount,
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });
}

export function useUserPreferences() {
  const isAuthenticated = useAppSelector((s) => s.auth.user !== null);
  return useQuery({
    queryKey: qk.preferences(),
    queryFn: fetchUserPreferences,
    enabled: isAuthenticated,
  });
}

export type { FeedFilters };
