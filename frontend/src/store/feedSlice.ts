import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type {
  Occurrence,
  FeedTab,
  FeedFilters,
  ExploreFeedResponse,
  HomeFeedResponse,
} from "../services/types";
import * as api from "../services/api";

type HomeFeedMeta = {
  followedCount: number;
  nearbyCount: number;
  totalFollows: number;
};

function isHomeFeedMeta(value: unknown): value is HomeFeedMeta {
  return (
    value != null &&
    typeof value === "object" &&
    "followedCount" in value &&
    "nearbyCount" in value &&
    "totalFollows" in value
  );
}

function resetFeedState(state: FeedState) {
  state.observations = [];
  state.cursor = undefined;
  state.hasMore = true;
  state.homeFeedMeta = null;
}

function applyHomeFeedMeta(state: FeedState, payload: ExploreFeedResponse | HomeFeedResponse) {
  if ("meta" in payload && isHomeFeedMeta(payload.meta)) {
    state.homeFeedMeta = payload.meta;
  }
}

interface ThunkApiConfig {
  state: { feed: FeedState; auth: { user: unknown } };
}

interface FeedState {
  observations: Occurrence[];
  cursor: string | undefined;
  isLoading: boolean;
  currentTab: FeedTab;
  hasMore: boolean;
  filters: FeedFilters;
  isAuthenticated: boolean;
  userLocation: { lat: number; lng: number } | null;
  homeFeedMeta: HomeFeedMeta | null;
}

const initialState: FeedState = {
  observations: [],
  cursor: undefined,
  isLoading: false,
  currentTab: "explore", // Default to explore to show all posts
  hasMore: true,
  filters: {},
  isAuthenticated: false,
  userLocation: null,
  homeFeedMeta: null,
};

export const loadFeed = createAsyncThunk<
  ExploreFeedResponse | HomeFeedResponse,
  void,
  ThunkApiConfig
>("feed/loadFeed", async (_, { getState }) => {
  const state = getState();
  const { currentTab, cursor, filters, userLocation } = state.feed;
  const isAuthenticated = !!state.auth?.user;

  if (currentTab === "home" && isAuthenticated) {
    return api.fetchHomeFeed(
      cursor,
      userLocation ? { ...userLocation, nearbyRadius: 50000 } : undefined,
    );
  }
  // Fall back to explore for unauthenticated users or explore tab
  return api.fetchExploreFeed(cursor, filters);
});

export const loadInitialFeed = createAsyncThunk<
  ExploreFeedResponse | HomeFeedResponse,
  void,
  ThunkApiConfig
>("feed/loadInitialFeed", async (_, { getState }) => {
  const state = getState();
  const { currentTab, filters, userLocation } = state.feed;
  const isAuthenticated = !!state.auth?.user;

  if (currentTab === "home" && isAuthenticated) {
    return api.fetchHomeFeed(
      undefined,
      userLocation ? { ...userLocation, nearbyRadius: 50000 } : undefined,
    );
  }
  return api.fetchExploreFeed(undefined, filters);
});

const feedSlice = createSlice({
  name: "feed",
  initialState,
  reducers: {
    switchTab: (state, action: PayloadAction<FeedTab>) => {
      state.currentTab = action.payload;
      resetFeedState(state);
    },
    resetFeed: (state) => {
      resetFeedState(state);
    },
    setFilters: (state, action: PayloadAction<FeedFilters>) => {
      state.filters = action.payload;
      resetFeedState(state);
    },
    setUserLocation: (state, action: PayloadAction<{ lat: number; lng: number } | null>) => {
      state.userLocation = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadFeed.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(loadFeed.fulfilled, (state, action) => {
        state.observations = [...state.observations, ...action.payload.occurrences];
        state.cursor = action.payload.cursor;
        state.hasMore = !!action.payload.cursor;
        state.isLoading = false;
        applyHomeFeedMeta(state, action.payload);
      })
      .addCase(loadFeed.rejected, (state) => {
        state.isLoading = false;
      })
      .addCase(loadInitialFeed.pending, (state) => {
        state.isLoading = true;
        state.observations = [];
        state.cursor = undefined;
      })
      .addCase(loadInitialFeed.fulfilled, (state, action) => {
        state.observations = action.payload.occurrences;
        state.cursor = action.payload.cursor;
        state.hasMore = !!action.payload.cursor;
        state.isLoading = false;
        applyHomeFeedMeta(state, action.payload);
      })
      .addCase(loadInitialFeed.rejected, (state) => {
        state.isLoading = false;
      });
  },
});

export const { switchTab, resetFeed, setFilters, setUserLocation } = feedSlice.actions;
export default feedSlice.reducer;
