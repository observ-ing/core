import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import feedReducer, { switchTab, setFilters } from "./feedSlice";

// feedSlice now holds only UI state (tab + filters); feed data is fetched via
// TanStack Query (lib/query/hooks `useFeed`), so there are no fetch thunks here.
const createTestStore = () => configureStore({ reducer: { feed: feedReducer } });

describe("feedSlice", () => {
  it("has the expected initial UI state", () => {
    const state = createTestStore().getState().feed;
    expect(state.currentTab).toBe("explore");
    expect(state.filters).toEqual({});
  });

  it("switchTab sets the current tab", () => {
    const store = createTestStore();
    store.dispatch(switchTab("home"));
    expect(store.getState().feed.currentTab).toBe("home");
  });

  it("setFilters replaces the filters", () => {
    const store = createTestStore();
    store.dispatch(setFilters({ taxon: "Quercus", kingdom: "Plantae" }));
    expect(store.getState().feed.filters).toEqual({ taxon: "Quercus", kingdom: "Plantae" });
  });
});
