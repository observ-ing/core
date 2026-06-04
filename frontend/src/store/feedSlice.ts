import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FeedFilters } from "../services/types";

// Feed *server data* lives in the TanStack Query cache (see lib/query/hooks.ts
// `useFeed`). This slice keeps only the explore filters — set by
// `ExploreFilterPanel`, a sibling of the feed, so they need shared state — which
// feed into the query key and drive refetch. The active tab is NOT stored here:
// it's just the route, read straight from the `tab` prop in `FeedView`/`useFeed`.
interface FeedState {
  filters: FeedFilters;
}

const initialState: FeedState = {
  filters: {},
};

const feedSlice = createSlice({
  name: "feed",
  initialState,
  reducers: {
    setFilters: (state, action: PayloadAction<FeedFilters>) => {
      state.filters = action.payload;
    },
  },
});

export const { setFilters } = feedSlice.actions;
export default feedSlice.reducer;
