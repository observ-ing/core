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
import type { Occurrence, ExploreFeedResponse, HomeFeedResponse } from "../services/types";

vi.mock("../services/api", () => ({
  fetchHomeFeed: vi.fn(),
  fetchExploreFeed: vi.fn(),
  checkAuth: vi.fn(),
  logout: vi.fn(),
}));

import * as api from "../services/api";

type StoreState = {
  feed: ReturnType<typeof feedReducer>;
  auth: ReturnType<typeof authReducer>;
};

function stubOccurrence(uri: string): Occurrence {
  return {
    uri,
    cid: "bafytest",
    observer: { did: "did:plc:test" },
    observers: [],
    subjects: [],
    eventDate: "2024-01-01",
    location: { latitude: 0, longitude: 0 },
    images: [],
    createdAt: "2024-01-01T00:00:00Z",
  };
}

// Build a store for testing. Uses Object.assign to merge partial state
// into defaults, avoiding issues with exactOptionalPropertyTypes.
function createTestStore(overrides?: {
  feed?: {
    observations?: Occurrence[];
    cursor?: string;
    currentTab?: "explore" | "home";
    hasMore?: boolean;
    filters?: Record<string, unknown>;
    userLocation?: { lat: number; lng: number } | null;
    homeFeedMeta?: { followedCount: number; nearbyCount: number; totalFollows: number } | null;
    occurrences?: Occurrence[];
  };
  auth?: { user: { did: string; handle: string } | null; isLoading: boolean };
}) {
  const feed = Object.assign(
    {
      observations: [] as Occurrence[],
      isLoading: false,
      currentTab: "explore" as const,
      hasMore: true,
      filters: {},
      isAuthenticated: false,
      userLocation: null as { lat: number; lng: number } | null,
      homeFeedMeta: null as { followedCount: number; nearbyCount: number; totalFollows: number } | null,
    },
    overrides?.feed,
  );
  const auth = overrides?.auth ?? { user: null, isLoading: false };

  return configureStore({
    reducer: { feed: feedReducer, auth: authReducer },
    preloadedState: { feed, auth } as StoreState,
  });
}

describe("feedSlice", () => {
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
          observations: [stubOccurrence("test")],
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
          observations: [stubOccurrence("test")],
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
          observations: [stubOccurrence("test")],
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
      const mockResponse: ExploreFeedResponse = {
        occurrences: [stubOccurrence("at://test1"), stubOccurrence("at://test2")],
        cursor: "next123",
      };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse);

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
      const mockResponse: ExploreFeedResponse = { occurrences: [] };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse);

      const store = createTestStore({
        auth: { user: { did: "did:plc:test", handle: "test" }, isLoading: false },
        feed: { currentTab: "explore" },
      });

      await store.dispatch(loadFeed());

      expect(api.fetchExploreFeed).toHaveBeenCalled();
      expect(api.fetchHomeFeed).not.toHaveBeenCalled();
    });

    it("loads home feed when authenticated and on home tab", async () => {
      const mockResponse: HomeFeedResponse = {
        occurrences: [stubOccurrence("at://home1")],
        cursor: "homecursor",
        meta: { followedCount: 5, nearbyCount: 3, totalFollows: 10 },
      };
      vi.mocked(api.fetchHomeFeed).mockResolvedValue(mockResponse);

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
      const mockResponse: ExploreFeedResponse = {
        occurrences: [stubOccurrence("at://new")],
      };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: {
          observations: [stubOccurrence("at://existing")],
          cursor: "prev",
        },
      });

      await store.dispatch(loadFeed());

      const obs = store.getState().feed.observations;
      expect(obs).toHaveLength(2);
      expect(obs[0]!.uri).toBe("at://existing");
      expect(obs[1]!.uri).toBe("at://new");
    });

    it("sets hasMore to false when no cursor", async () => {
      const mockResponse: ExploreFeedResponse = { occurrences: [] };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse);

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
      const mockResponse: ExploreFeedResponse = {
        occurrences: [stubOccurrence("at://new")],
      };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { observations: [stubOccurrence("at://old")] },
      });

      await store.dispatch(loadInitialFeed());

      // Should replace, not append
      expect(store.getState().feed.observations).toHaveLength(1);
      expect(store.getState().feed.observations[0]!.uri).toBe("at://new");
    });

    it("loads home feed for authenticated user on home tab", async () => {
      const mockResponse: HomeFeedResponse = {
        occurrences: [],
        meta: { followedCount: 0, nearbyCount: 0, totalFollows: 0 },
      };
      vi.mocked(api.fetchHomeFeed).mockResolvedValue(mockResponse);

      const store = createTestStore({
        auth: { user: { did: "did:plc:user", handle: "user" }, isLoading: false },
        feed: { currentTab: "home" },
      });

      await store.dispatch(loadInitialFeed());

      expect(api.fetchHomeFeed).toHaveBeenCalledWith(undefined, undefined);
    });

    it("passes filters for explore feed", async () => {
      const mockResponse: ExploreFeedResponse = { occurrences: [] };
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse);

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
        feed: { cursor: "oldcursor", observations: [stubOccurrence("old")] },
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
      const mockResponse: HomeFeedResponse = {
        occurrences: [],
        meta: { followedCount: 10, nearbyCount: 5, totalFollows: 50 },
      };
      vi.mocked(api.fetchHomeFeed).mockResolvedValue(mockResponse);

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
