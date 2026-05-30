// Central query-key registry. Keeping every key in one place lets the
// occurrence-cache patcher (occurrenceCache.ts) reliably target every cache
// that holds likeable occurrences.
import type { FeedFilters, FeedTab } from "../../services/types";

// The first element of each key is a stable string tag we match on.
export const qk = {
  // Occurrence-bearing caches (the ones likes must patch) -------------------
  feed: (tab: FeedTab, filters: FeedFilters) => ["feed", tab, filters] as const,
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
