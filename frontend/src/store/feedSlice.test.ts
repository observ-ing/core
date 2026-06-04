import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import feedReducer, { setFilters } from "./feedSlice";

// feedSlice holds only the explore filters; feed data is fetched via TanStack
// Query (lib/query/hooks `useFeed`) and the active tab is the route, so there
// are no fetch thunks and no tab state here.
const createTestStore = () => configureStore({ reducer: { feed: feedReducer } });

describe("feedSlice", () => {
  it("has the expected initial UI state", () => {
    const state = createTestStore().getState().feed;
    expect(state.filters).toEqual({});
  });

  it("setFilters replaces the filters", () => {
    const store = createTestStore();
    store.dispatch(setFilters({ taxon: "Quercus", kingdom: "Plantae" }));
    expect(store.getState().feed.filters).toEqual({ taxon: "Quercus", kingdom: "Plantae" });
  });
});
