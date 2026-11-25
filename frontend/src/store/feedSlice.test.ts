import { describe, it, expect } from "vitest";
import { makeStore } from "./index";
import { setFilters } from "./feedSlice";

// feedSlice holds only the explore filters; feed data is fetched via TanStack
// Query (lib/query/hooks `useFeed`) and the active tab is the route, so there
// are no fetch thunks and no tab state here.
describe("feedSlice", () => {
  it("has the expected initial UI state", () => {
    const state = makeStore().getState().feed;
    expect(state.filters).toEqual({});
  });

  it("setFilters replaces the filters", () => {
    const store = makeStore();
    store.dispatch(setFilters({ taxon: "Quercus", kingdom: "Plantae" }));
    expect(store.getState().feed.filters).toEqual({ taxon: "Quercus", kingdom: "Plantae" });
  });
});
