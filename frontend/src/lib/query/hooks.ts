// Read hooks — one per server endpoint. Components call these instead of
// fetching into useState/Redux; caching, dedup, offline persistence, and
// refetch-on-focus come from the shared QueryClient.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
import type { FeedFilters } from "../../services/types";

type Cursor = string | undefined;
const nextCursor = (last: { cursor?: string }): Cursor => last.cursor ?? undefined;

// ── Occurrence feeds (infinite) ──────────────────────────────────────────────

/** Home/explore feed. Reads tab + filters + auth from Redux as query inputs. */
export function useFeed() {
  const tab = useAppSelector((s) => s.feed.currentTab);
  const filters = useAppSelector((s) => s.feed.filters);
  const isAuthenticated = useAppSelector((s) => s.auth.user !== null);

  return useInfiniteQuery({
    queryKey: qk.feed(tab, filters),
    queryFn: ({ pageParam }: { pageParam: Cursor }) =>
      tab === "home" && isAuthenticated
        ? fetchHomeFeed(pageParam)
        : fetchExploreFeed(pageParam, filters),
    initialPageParam: undefined as Cursor,
    getNextPageParam: nextCursor,
  });
}

export function useProfileFeed(did: string, type: "observations" | "identifications") {
  return useInfiniteQuery({
    queryKey: qk.profileFeed(did, type),
    queryFn: ({ pageParam }: { pageParam: Cursor }) => fetchProfileFeed(did, pageParam, type),
    initialPageParam: undefined as Cursor,
    getNextPageParam: nextCursor,
    enabled: !!did,
  });
}

export function useTaxonOccurrences(kingdomOrId: string, name?: string) {
  return useInfiniteQuery({
    queryKey: qk.taxonOccurrences(kingdomOrId, name),
    queryFn: ({ pageParam }: { pageParam: Cursor }) =>
      fetchTaxonObservations(kingdomOrId, name, pageParam),
    initialPageParam: undefined as Cursor,
    getNextPageParam: nextCursor,
    enabled: !!kingdomOrId,
  });
}

// ── Single reads ─────────────────────────────────────────────────────────────

export function useObservation(uri: string | undefined) {
  return useQuery({
    queryKey: qk.observation(uri ?? ""),
    queryFn: () => fetchObservation(uri!),
    enabled: !!uri,
  });
}

export function useTaxon(kingdomOrId: string | undefined, name?: string) {
  return useQuery({
    queryKey: qk.taxon(kingdomOrId ?? "", name),
    queryFn: () => fetchTaxon(kingdomOrId!, name),
    enabled: !!kingdomOrId,
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
    initialPageParam: undefined as Cursor,
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
