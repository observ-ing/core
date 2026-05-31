import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FeedTab, FeedFilters } from "../services/types";

// Feed *server data* now lives in the TanStack Query cache (see
// lib/query/hooks.ts `useFeed`). This slice keeps only the UI inputs that
// select which feed to show; changing them changes the query key, which
// drives the refetch.
interface FeedState {
  currentTab: FeedTab;
  filters: FeedFilters;
}

const initialState: FeedState = {
  currentTab: "explore",
  filters: {},
};

const feedSlice = createSlice({
  name: "feed",
  initialState,
  reducers: {
    switchTab: (state, action: PayloadAction<FeedTab>) => {
      state.currentTab = action.payload;
    },
    setFilters: (state, action: PayloadAction<FeedFilters>) => {
      state.filters = action.payload;
    },
  },
});

export const { switchTab, setFilters } = feedSlice.actions;
export default feedSlice.reducer;
