// Cross-cache occurrence consistency. An occurrence (with its viewerHasLiked /
// likeCount) can appear in many caches at once: the home/explore feed, a
// profile feed, a taxon's occurrence list, and its own detail view. When a
// like toggles we patch the entity in EVERY cache that holds it, so all views
// stay consistent from a single mutation — the normalized-update behavior that
// motivated moving this data out of the service worker.
import type { InfiniteData } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { OCCURRENCE_LIST_TAGS } from "./keys";
import type { Occurrence, OccurrenceDetailResponse } from "../../services/types";

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
