import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FeedTab, FeedFilters } from "../services/types";

interface FeedState {
  currentTab: FeedTab;
  exploreFilters: FeedFilters;
  userLocation: { lat: number; lng: number } | null;
}

const initialState: FeedState = {
  currentTab: "explore",
  exploreFilters: {},
  userLocation: null,
};

const feedSlice = createSlice({
  name: "feed",
  initialState,
  reducers: {
    switchTab: (state, action: PayloadAction<FeedTab>) => {
      state.currentTab = action.payload;
    },
    setExploreFilters: (state, action: PayloadAction<FeedFilters>) => {
      state.exploreFilters = action.payload;
    },
    resetExploreFilters: (state) => {
      state.exploreFilters = {};
    },
    setUserLocation: (state, action: PayloadAction<{ lat: number; lng: number } | null>) => {
      state.userLocation = action.payload;
    },
  },
});

export const { switchTab, setExploreFilters, resetExploreFilters, setUserLocation } = feedSlice.actions;
export default feedSlice.reducer;