import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchHomeFeed, fetchExploreFeed } from "../services/api";
import type { FeedTab, HomeFeedResponse, ExploreFeedResponse } from "../services/types";
import { useAppSelector } from "../store";

export function useFeed(tab: FeedTab) {
  const exploreFilters = useAppSelector((state) => state.feed.exploreFilters);
  const user = useAppSelector((state) => state.auth.user);

  return useInfiniteQuery<HomeFeedResponse | ExploreFeedResponse, Error>({
    queryKey: ["feed", tab, tab === "explore" ? exploreFilters : null, user?.did],
    queryFn: async ({ pageParam }) => {
      const cursor = typeof pageParam === "string" ? pageParam : undefined;
      if (tab === "home") {
        return fetchHomeFeed(cursor);
      } else {
        return fetchExploreFeed(cursor, exploreFilters);
      }
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.cursor || undefined,
  });
}
