// Cross-cache occurrence consistency. An occurrence (with its viewerHasLiked /
// likeCount) can appear in many caches at once: the home/explore feed, a
// profile feed, a taxon's occurrence list, and its own detail view. When a
// like toggles we patch the entity in EVERY cache that holds it, so all views
// stay consistent from a single mutation — the normalized-update behavior that
// motivated moving this data out of the service worker.
import type { InfiniteData } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { OCCURRENCE_LIST_TAGS } from "./keys";
import type {
  EffectiveTaxonomy,
  Occurrence,
  OccurrenceDetailResponse,
  Profile,
} from "../../services/types";

// Any infinite-query page that carries occurrences (feed / profile / taxon).
type OccurrencePage = { occurrences: Occurrence[]; cursor?: string };

function applyLike(occ: Occurrence, liked: boolean): Occurrence {
  if (occ.viewerHasLiked === liked) return occ;
  return {
    ...occ,
    viewerHasLiked: liked,
    likeCount: (occ.likeCount ?? 0) + (liked ? 1 : -1),
  };
}

/**
 * Set `viewerHasLiked` (and adjust `likeCount`) for one occurrence across all
 * caches that reference it. Idempotent: re-applying the same state is a no-op,
 * so optimistic-apply followed by the server-confirmed write won't double-count.
 */
export function setOccurrenceLike(uri: string, liked: boolean): void {
  // Infinite list caches (feed / profileFeed / taxonOccurrences).
  queryClient.setQueriesData<InfiniteData<OccurrencePage>>(
    {
      predicate: (query) => OCCURRENCE_LIST_TAGS.some((tag) => tag === query.queryKey[0]),
    },
    (data) => {
      if (!data?.pages) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          occurrences: page.occurrences.map((o) => (o.uri === uri ? applyLike(o, liked) : o)),
        })),
      };
    },
  );

  // Single observation-detail cache.
  queryClient.setQueryData<OccurrenceDetailResponse>(["observation", uri], (data) =>
    data ? { ...data, occurrence: applyLike(data.occurrence, liked) } : data,
  );
}

/**
 * Refetch every occurrence list (feed / profile / taxon). Call after a
 * create / update / delete so the new/changed/removed observation is reflected
 * everywhere — replaces the old full-page reloads.
 */
export function invalidateOccurrenceLists(): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => OCCURRENCE_LIST_TAGS.some((tag) => tag === query.queryKey[0]),
  });
}

/** Refetch one observation's detail cache (after an edit). */
export function invalidateObservation(uri: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ["observation", uri] });
}

/** Drop one observation's detail cache (after a delete). */
export function removeObservation(uri: string): void {
  queryClient.removeQueries({ queryKey: ["observation", uri] });
}

// ── Optimistic "tombstone" rows ──────────────────────────────────────────────
// A freshly-submitted observation only lands in the app DB after the async
// tap-ingester replays the PDS commit (seconds later). To make the submission
// feel instant we splice a client-built placeholder — a "tombstone" — into the
// feeds right away, then swap it for the canonical record once the ingester has
// it (`reconcileOccurrence`). Until then the row renders dimmed (the pending
// slice tracks its uri) with the uploader's own inline image preview.

// Optional fields accept an explicit `undefined` (not just absence) so the call
// site can pass `value || undefined` directly under exactOptionalPropertyTypes.
/** Fields the client can fill in for a just-submitted, not-yet-ingested row. */
export interface TombstoneInput {
  uri: string;
  cid: string;
  observer: Profile;
  latitude: number;
  longitude: number;
  uncertaintyMeters?: number | undefined;
  eventDate?: string | undefined;
  scientificName?: string | undefined;
  kingdom?: string | undefined;
  rank?: string | undefined;
  /** `data:`/`blob:` preview URLs for the uploader's just-picked photos. */
  imageUrls: string[];
  license?: string | undefined;
  organismQuantity?: string | undefined;
  organismQuantityType?: string | undefined;
  createdAt: string;
}

/**
 * Build a best-effort Occurrence from the submit form's own state. The
 * server-resolved bits we can't know yet (full taxonomy hierarchy, community
 * id, real blob URLs, quality issues) are left empty/optimistic and arrive when
 * `reconcileOccurrence` replaces this row.
 */
export function makeTombstoneOccurrence(input: TombstoneInput): Occurrence {
  const effectiveTaxonomy: EffectiveTaxonomy | undefined = input.scientificName
    ? {
        scientificName: input.scientificName,
        ...(input.rank ? { rank: input.rank } : {}),
        ...(input.kingdom ? { kingdom: input.kingdom } : {}),
      }
    : undefined;

  return {
    uri: input.uri,
    cid: input.cid,
    observer: input.observer,
    ...(effectiveTaxonomy ? { effectiveTaxonomy } : {}),
    identificationCount: 0,
    ...(input.eventDate ? { eventDate: input.eventDate } : {}),
    location: {
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.uncertaintyMeters != null ? { uncertaintyMeters: input.uncertaintyMeters } : {}),
    },
    ...(input.organismQuantity ? { organismQuantity: input.organismQuantity } : {}),
    ...(input.organismQuantityType ? { organismQuantityType: input.organismQuantityType } : {}),
    images: input.imageUrls.map((url) => ({
      url,
      ...(input.license ? { license: input.license } : {}),
    })),
    createdAt: input.createdAt,
    likeCount: 0,
    viewerHasLiked: false,
    qualityIssues: [],
  };
}

/**
 * Insert a tombstone at the top of the caches the author is most likely looking
 * at right after submitting: the home/explore feed and their own profile feed.
 * We deliberately skip taxonOccurrences — we can't reliably tell which taxon
 * page a row belongs to client-side, and those reconcile on their next refresh.
 * `setQueriesData` only touches caches that already exist, so an unmounted feed
 * is simply left alone (it fetches fresh when next opened).
 */
export function prependOccurrence(occ: Occurrence, authorDid: string): void {
  queryClient.setQueriesData<InfiniteData<OccurrencePage>>(
    {
      predicate: (query) => {
        const [tag, did, type] = query.queryKey;
        if (tag === "feed") return true;
        if (tag === "profileFeed") return did === authorDid && type === "observations";
        return false;
      },
    },
    (data) => {
      if (!data?.pages.length) return data;
      const [first, ...rest] = data.pages;
      if (!first) return data;
      // Guard against a double insert (e.g. React strict-mode re-invocation).
      if (data.pages.some((p) => p.occurrences.some((o) => o.uri === occ.uri))) return data;
      return {
        ...data,
        pages: [{ ...first, occurrences: [occ, ...first.occurrences] }, ...rest],
      };
    },
  );
}

/**
 * Replace a tombstone with the canonical record once the ingester has it,
 * patching every list cache by uri and seeding the detail cache. This swaps the
 * optimistic fields (unresolved taxonomy, inline preview image) for real server
 * data without a full feed refetch — preserving the feed's no-reorder behavior.
 */
export function reconcileOccurrence(detail: OccurrenceDetailResponse): void {
  const { occurrence } = detail;
  queryClient.setQueriesData<InfiniteData<OccurrencePage>>(
    {
      predicate: (query) => OCCURRENCE_LIST_TAGS.some((tag) => tag === query.queryKey[0]),
    },
    (data) => {
      if (!data?.pages) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          occurrences: page.occurrences.map((o) => (o.uri === occurrence.uri ? occurrence : o)),
        })),
      };
    },
  );

  queryClient.setQueryData<OccurrenceDetailResponse>(["observation", occurrence.uri], detail);
}
