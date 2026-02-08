import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import feedReducer, {
  loadFeed,
  loadInitialFeed,
  switchTab,
  resetFeed,
  setFilters,
  setUserLocation,
} from "./feedSlice";
import authReducer from "./authSlice";

vi.mock("../services/api", () => ({
  fetchHomeFeed: vi.fn(),
  fetchExploreFeed: vi.fn(),
  checkAuth: vi.fn(),
  logout: vi.fn(),
}));

import * as api from "../services/api";

describe("feedSlice", () => {
  const defaultFeedState = {
    observations: [],
    cursor: undefined,
    isLoading: false,
    currentTab: "explore" as const,
    hasMore: true,
    filters: {},
    isAuthenticated: false,
    userLocation: null,
    homeFeedMeta: null,
  };

  const createTestStore = (preloadedState?: {
    feed?: Partial<typeof defaultFeedState>;
    auth?: { user: { did: string; handle: string } | null; isLoading: boolean };
  }) =>
    configureStore({
      reducer: { feed: feedReducer, auth: authReducer },
      preloadedState: {
        feed: { ...defaultFeedState, ...preloadedState?.feed },
        auth: preloadedState?.auth ?? { user: null, isLoading: false },
      } as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has correct initial state", () => {
      const store = createTestStore();
      const state = store.getState().feed;

      expect(state.observations).toEqual([]);
      expect(state.cursor).toBeUndefined();
      expect(state.isLoading).toBe(false);
      expect(state.currentTab).toBe("explore");
      expect(state.hasMore).toBe(true);
      expect(state.filters).toEqual({});
      expect(state.userLocation).toBeNull();
      expect(state.homeFeedMeta).toBeNull();
    });
  });

  describe("switchTab", () => {
    it("switches tab and resets state", () => {
      const store = createTestStore({
        feed: {
          observations: [{ uri: "test" } as any],
          cursor: "abc",
          currentTab: "explore",
          hasMore: false,
          homeFeedMeta: { followedCount: 5, nearbyCount: 10, totalFollows: 20 },
        },
      });

      store.dispatch(switchTab("home"));

      const state = store.getState().feed;
      expect(state.currentTab).toBe("home");
      expect(state.observations).toEqual([]);
      expect(state.cursor).toBeUndefined();
      expect(state.hasMore).toBe(true);
      expect(state.homeFeedMeta).toBeNull();
    });
  });

  describe("resetFeed", () => {
    it("resets feed state", () => {
      const store = createTestStore({
        feed: {
          observations: [{ uri: "test" } as any],
          cursor: "abc",
          hasMore: false,
          homeFeedMeta: { followedCount: 5, nearbyCount: 10, totalFollows: 20 },
        },
      });

      store.dispatch(resetFeed());

      const state = store.getState().feed;
      expect(state.observations).toEqual([]);
      expect(state.cursor).toBeUndefined();
      expect(state.hasMore).toBe(true);
      expect(state.homeFeedMeta).toBeNull();
    });
  });

  describe("setFilters", () => {
    it("sets filters and resets feed", () => {
      const store = createTestStore({
        feed: {
          observations: [{ uri: "test" } as any],
          cursor: "abc",
          hasMore: false,
          filters: {},
        },
      });

      store.dispatch(setFilters({ taxon: "Quercus", lat: 40, lng: -74 }));

      const state = store.getState().feed;
      expect(state.filters).toEqual({ taxon: "Quercus", lat: 40, lng: -74 });
      expect(state.observations).toEqual([]);
      expect(state.cursor).toBeUndefined();
      expect(state.hasMore).toBe(true);
    });
  });

  describe("setUserLocation", () => {
    it("sets user location", () => {
      const store = createTestStore();
      store.dispatch(setUserLocation({ lat: 40.7128, lng: -74.006 }));

      expect(store.getState().feed.userLocation).toEqual({
        lat: 40.7128,
        lng: -74.006,
      });
    });

    it("clears user location with null", () => {
      const store = createTestStore({
        feed: { userLocation: { lat: 40, lng: -74 } },
      });

      store.dispatch(setUserLocation(null));

      expect(store.getState().feed.userLocation).toBeNull();
    });
  });

  describe("loadFeed thunk", () => {
    it("loads explore feed when not authenticated", async () => {
      const mockResponse = {
        occurrences: [{ uri: "at://test1" }, { uri: "at://test2" }],
        cursor: "next123",
      };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse as any);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { currentTab: "explore", filters: { taxon: "Oak" } },
      });

      await store.dispatch(loadFeed());

      expect(api.fetchExploreFeed).toHaveBeenCalledWith(undefined, { taxon: "Oak" });
      expect(store.getState().feed.observations).toHaveLength(2);
      expect(store.getState().feed.cursor).toBe("next123");
      expect(store.getState().feed.hasMore).toBe(true);
    });

    it("loads explore feed when on explore tab even if authenticated", async () => {
      const mockResponse = { occurrences: [], cursor: undefined };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse as any);

      const store = createTestStore({
        auth: { user: { did: "did:plc:test", handle: "test" }, isLoading: false },
        feed: { currentTab: "explore" },
      });

      await store.dispatch(loadFeed());

      expect(api.fetchExploreFeed).toHaveBeenCalled();
      expect(api.fetchHomeFeed).not.toHaveBeenCalled();
    });

    it("loads home feed when authenticated and on home tab", async () => {
      const mockResponse = {
        occurrences: [{ uri: "at://home1" }],
        cursor: "homecursor",
        meta: { followedCount: 5, nearbyCount: 3, totalFollows: 10 },
      };
      vi.mocked(api.fetchHomeFeed).mockResolvedValue(mockResponse as any);

      const store = createTestStore({
        auth: { user: { did: "did:plc:test", handle: "test" }, isLoading: false },
        feed: { currentTab: "home", userLocation: { lat: 40, lng: -74 } },
      });

      await store.dispatch(loadFeed());

      expect(api.fetchHomeFeed).toHaveBeenCalledWith(undefined, {
        lat: 40,
        lng: -74,
        nearbyRadius: 50000,
      });
      expect(store.getState().feed.homeFeedMeta).toEqual({
        followedCount: 5,
        nearbyCount: 3,
        totalFollows: 10,
      });
    });

    it("sets isLoading during request", async () => {
      vi.mocked(api.fetchExploreFeed).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const store = createTestStore({
        auth: { user: null, isLoading: false },
      });

      store.dispatch(loadFeed());

      expect(store.getState().feed.isLoading).toBe(true);
    });

    it("appends to existing occurrences on load more", async () => {
      const mockResponse = {
        occurrences: [{ uri: "at://new" }],
        cursor: undefined,
      };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse as any);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: {
          observations: [{ uri: "at://existing" } as any],
          cursor: "prev",
        },
      });

      await store.dispatch(loadFeed());

      expect(store.getState().feed.observations).toHaveLength(2);
      expect(store.getState().feed.observations[0].uri).toBe("at://existing");
      expect(store.getState().feed.observations[1].uri).toBe("at://new");
    });

    it("sets hasMore to false when no cursor", async () => {
      vi.mocked(api.fetchExploreFeed).mockResolvedValue({
        occurrences: [],
        cursor: undefined,
      } as any);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
      });

      await store.dispatch(loadFeed());

      expect(store.getState().feed.hasMore).toBe(false);
    });

    it("handles rejected state", async () => {
      vi.mocked(api.fetchExploreFeed).mockRejectedValue(new Error("Network error"));

      const store = createTestStore({
        auth: { user: null, isLoading: false },
      });

      await store.dispatch(loadFeed());

      expect(store.getState().feed.isLoading).toBe(false);
    });
  });

  describe("loadInitialFeed thunk", () => {
    it("clears occurrences before loading", async () => {
      vi.mocked(api.fetchExploreFeed).mockResolvedValue({
        occurrences: [{ uri: "at://new" }],
        cursor: undefined,
      } as any);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { occurrences: [{ uri: "at://old" } as any] },
      });

      await store.dispatch(loadInitialFeed());

      // Should replace, not append
      expect(store.getState().feed.observations).toHaveLength(1);
      expect(store.getState().feed.observations[0].uri).toBe("at://new");
    });

    it("loads home feed for authenticated user on home tab", async () => {
      vi.mocked(api.fetchHomeFeed).mockResolvedValue({
        occurrences: [],
        cursor: undefined,
        meta: { followedCount: 0, nearbyCount: 0, totalFollows: 0 },
      } as any);

      const store = createTestStore({
        auth: { user: { did: "did:plc:user", handle: "user" }, isLoading: false },
        feed: { currentTab: "home" },
      });

      await store.dispatch(loadInitialFeed());

      expect(api.fetchHomeFeed).toHaveBeenCalledWith(undefined, undefined);
    });

    it("passes filters for explore feed", async () => {
      vi.mocked(api.fetchExploreFeed).mockResolvedValue({
        occurrences: [],
        cursor: undefined,
      } as any);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { currentTab: "explore", filters: { taxon: "Bird" } },
      });

      await store.dispatch(loadInitialFeed());

      expect(api.fetchExploreFeed).toHaveBeenCalledWith(undefined, { taxon: "Bird" });
    });

    it("clears cursor on pending", () => {
      vi.mocked(api.fetchExploreFeed).mockImplementation(
        () => new Promise(() => {})
      );

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { cursor: "oldcursor", occurrences: [{ uri: "old" } as any] },
      });

      store.dispatch(loadInitialFeed());

      const state = store.getState().feed;
      expect(state.cursor).toBeUndefined();
      expect(state.observations).toEqual([]);
      expect(state.isLoading).toBe(true);
    });

    it("handles rejected state", async () => {
      vi.mocked(api.fetchExploreFeed).mockRejectedValue(new Error("Failed"));

      const store = createTestStore({
        auth: { user: null, isLoading: false },
      });

      await store.dispatch(loadInitialFeed());

      expect(store.getState().feed.isLoading).toBe(false);
    });

    it("populates homeFeedMeta from response", async () => {
      vi.mocked(api.fetchHomeFeed).mockResolvedValue({
        occurrences: [],
        cursor: undefined,
        meta: { followedCount: 10, nearbyCount: 5, totalFollows: 50 },
      } as any);

      const store = createTestStore({
        auth: { user: { did: "did:plc:user", handle: "user" }, isLoading: false },
        feed: { currentTab: "home" },
      });

      await store.dispatch(loadInitialFeed());

      expect(store.getState().feed.homeFeedMeta).toEqual({
        followedCount: 10,
        nearbyCount: 5,
        totalFollows: 50,
      });
    });
  });
});
