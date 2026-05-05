import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import feedReducer, {
  loadFeed,
  loadInitialFeed,
  switchTab,
  resetFeed,
  setFilters,
} from "./feedSlice";
import authReducer from "./authSlice";
import type {
  Occurrence,
  ExploreFeedResponse,
  HomeFeedResponse,
  User,
  FeedTab,
  FeedFilters,
} from "../services/types";

vi.mock("../services/api", () => ({
  fetchHomeFeed: vi.fn(),
  fetchExploreFeed: vi.fn(),
  checkAuth: vi.fn(),
  logout: vi.fn(),
}));

import * as api from "../services/api";

function makeOccurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    uri: "at://test",
    cid: "test-cid",
    observer: { did: "did:plc:default", handle: "default.bsky.social" },
    identificationCount: 0,
    eventDate: "2024-01-01",
    location: { latitude: 0, longitude: 0 },
    images: [],
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFeedResponse(
  occurrences: Occurrence[] = [],
  cursor?: string,
): ExploreFeedResponse & HomeFeedResponse {
  return cursor === undefined ? { occurrences } : { occurrences, cursor };
}

interface FeedOverrides {
  observations?: Occurrence[];
  cursor?: string | undefined;
  isLoading?: boolean;
  currentTab?: FeedTab;
  hasMore?: boolean;
  filters?: FeedFilters;
  isAuthenticated?: boolean;
}

interface AuthOverrides {
  user: User | null;
  isLoading: boolean;
}

interface FeedStateShape {
  observations: Occurrence[];
  cursor: string | undefined;
  isLoading: boolean;
  currentTab: FeedTab;
  hasMore: boolean;
  filters: FeedFilters;
  isAuthenticated: boolean;
}

describe("feedSlice", () => {
  const defaultFeedState: FeedStateShape = {
    observations: [],
    cursor: undefined,
    isLoading: false,
    currentTab: "explore",
    hasMore: true,
    filters: {},
    isAuthenticated: false,
  };

  const createTestStore = (preloadedState?: { feed?: FeedOverrides; auth?: AuthOverrides }) =>
    configureStore({
      reducer: { feed: feedReducer, auth: authReducer },
      preloadedState: {
        feed: { ...defaultFeedState, ...preloadedState?.feed },
        auth: preloadedState?.auth ?? { user: null, isLoading: false },
      },
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
    });
  });

  describe("switchTab", () => {
    it("switches tab and resets state", () => {
      const store = createTestStore({
        feed: {
          observations: [makeOccurrence({ uri: "test" })],
          cursor: "abc",
          currentTab: "explore",
          hasMore: false,
        },
      });

      store.dispatch(switchTab("home"));

      const state = store.getState().feed;
      expect(state.currentTab).toBe("home");
      expect(state.observations).toEqual([]);
      expect(state.cursor).toBeUndefined();
      expect(state.hasMore).toBe(true);
    });
  });

  describe("resetFeed", () => {
    it("resets feed state", () => {
      const store = createTestStore({
        feed: {
          observations: [makeOccurrence({ uri: "test" })],
          cursor: "abc",
          hasMore: false,
        },
      });

      store.dispatch(resetFeed());

      const state = store.getState().feed;
      expect(state.observations).toEqual([]);
      expect(state.cursor).toBeUndefined();
      expect(state.hasMore).toBe(true);
    });
  });

  describe("setFilters", () => {
    it("sets filters and resets feed", () => {
      const store = createTestStore({
        feed: {
          observations: [makeOccurrence({ uri: "test" })],
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

  describe("loadFeed thunk", () => {
    it("loads explore feed when not authenticated", async () => {
      const mockResponse = makeFeedResponse(
        [makeOccurrence({ uri: "at://test1" }), makeOccurrence({ uri: "at://test2" })],
        "next123",
      );
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
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(makeFeedResponse());

      const store = createTestStore({
        auth: {
          user: { did: "did:plc:test", handle: "test" },
          isLoading: false,
        },
        feed: { currentTab: "explore" },
      });

      await store.dispatch(loadFeed());

      expect(api.fetchExploreFeed).toHaveBeenCalled();
      expect(api.fetchHomeFeed).not.toHaveBeenCalled();
    });

    it("loads home feed when authenticated and on home tab", async () => {
      const mockResponse = makeFeedResponse([makeOccurrence({ uri: "at://home1" })], "homecursor");
      vi.mocked(api.fetchHomeFeed).mockResolvedValue(mockResponse);

      const store = createTestStore({
        auth: {
          user: { did: "did:plc:test", handle: "test" },
          isLoading: false,
        },
        feed: { currentTab: "home" },
      });

      await store.dispatch(loadFeed());

      expect(api.fetchHomeFeed).toHaveBeenCalledWith(undefined);
    });

    it("sets isLoading during request", () => {
      vi.mocked(api.fetchExploreFeed).mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );

      const store = createTestStore({
        auth: { user: null, isLoading: false },
      });

      store.dispatch(loadFeed());

      expect(store.getState().feed.isLoading).toBe(true);
    });

    it("appends to existing occurrences on load more", async () => {
      const mockResponse = makeFeedResponse([makeOccurrence({ uri: "at://new" })]);
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(mockResponse);

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: {
          observations: [makeOccurrence({ uri: "at://existing" })],
          cursor: "prev",
        },
      });

      await store.dispatch(loadFeed());

      expect(store.getState().feed.observations).toHaveLength(2);
      expect(store.getState().feed.observations[0].uri).toBe("at://existing");
      expect(store.getState().feed.observations[1].uri).toBe("at://new");
    });

    it("sets hasMore to false when no cursor", async () => {
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(makeFeedResponse());

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
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(
        makeFeedResponse([makeOccurrence({ uri: "at://new" })]),
      );

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { observations: [makeOccurrence({ uri: "at://old" })] },
      });

      await store.dispatch(loadInitialFeed());

      // Should replace, not append
      expect(store.getState().feed.observations).toHaveLength(1);
      expect(store.getState().feed.observations[0].uri).toBe("at://new");
    });

    it("loads home feed for authenticated user on home tab", async () => {
      vi.mocked(api.fetchHomeFeed).mockResolvedValue(makeFeedResponse());

      const store = createTestStore({
        auth: {
          user: { did: "did:plc:user", handle: "user" },
          isLoading: false,
        },
        feed: { currentTab: "home" },
      });

      await store.dispatch(loadInitialFeed());

      expect(api.fetchHomeFeed).toHaveBeenCalledWith(undefined);
    });

    it("passes filters for explore feed", async () => {
      vi.mocked(api.fetchExploreFeed).mockResolvedValue(makeFeedResponse());

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { currentTab: "explore", filters: { taxon: "Bird" } },
      });

      await store.dispatch(loadInitialFeed());

      expect(api.fetchExploreFeed).toHaveBeenCalledWith(undefined, { taxon: "Bird" });
    });

    it("clears cursor on pending", () => {
      vi.mocked(api.fetchExploreFeed).mockImplementation(() => new Promise(() => {}));

      const store = createTestStore({
        auth: { user: null, isLoading: false },
        feed: { cursor: "oldcursor", observations: [makeOccurrence({ uri: "old" })] },
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
  });
});
