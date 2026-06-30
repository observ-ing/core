// Central query-key registry. Keeping every key in one place lets the
// occurrence-cache patcher (occurrenceCache.ts) reliably target every cache
// that holds likeable occurrences.
import type { FeedFilters, FeedTab } from "../../services/types";

// The first element of each key is a stable string tag we match on.
export const qk = {
  // Occurrence-bearing caches (the ones likes must patch) -------------------
  // `isAuthenticated` is part of the key because `useFeed` fetches a different
  // endpoint for the signed-in home tab (`/feeds/home`, quality-filtered) vs.
  // the signed-out / explore fallback (`/feeds/explore`, unfiltered). Leaving
  // it out let an explore response fetched during the startup auth-check window
  // get cached under the home key and never refetch once auth resolved, so the
  // home feed nondeterministically showed explore posts. Keying on it makes the
  // two states distinct caches and forces a refetch when auth flips.
  feed: (tab: FeedTab, filters: FeedFilters, isAuthenticated: boolean) =>
    ["feed", tab, filters, isAuthenticated] as const,
  profileFeed: (did: string, type: "observations" | "identifications") =>
    ["profileFeed", did, type] as const,
  taxonOccurrences: (kingdomOrId: string, name?: string) =>
    ["taxonOccurrences", kingdomOrId, name ?? null] as const,
  observation: (uri: string) => ["observation", uri] as const,

  // Other server reads ------------------------------------------------------
  taxon: (kingdomOrId: string, name?: string) => ["taxon", kingdomOrId, name ?? null] as const,
  taxonChildren: (kingdom: string, name: string) => ["taxonChildren", kingdom, name] as const,
  taxaSearch: (query: string) => ["taxaSearch", query] as const,
  validateTaxon: (name: string, kingdom?: string) =>
    ["validateTaxon", name, kingdom ?? null] as const,
  geojson: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) =>
    ["geojson", bounds] as const,
  notifications: () => ["notifications"] as const,
  unreadCount: () => ["unreadCount"] as const,
  preferences: () => ["preferences"] as const,
} as const;

// Key tags whose caches contain `occurrences: Occurrence[]` pages.
export const OCCURRENCE_LIST_TAGS = ["feed", "profileFeed", "taxonOccurrences"] as const;
