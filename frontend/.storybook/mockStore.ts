import type { Action } from "@reduxjs/toolkit";
import { makeStore, type RootState } from "../src/store";

export interface StoreOptions {
  /** Seed slice state at construction (e.g. an authed user). */
  preloadedState?: Partial<RootState>;
  /** Actions to dispatch immediately after the store is built (e.g. queue a toast). */
  actions?: Action[];
}

/**
 * Build a fresh Redux store for a story so state doesn't leak across stories.
 */
export function makeMockStore(options?: StoreOptions) {
  const store = makeStore(options?.preloadedState);
  options?.actions?.forEach((action) => store.dispatch(action));
  return store;
}
