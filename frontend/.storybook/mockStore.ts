import { combineReducers, configureStore, type Action } from "@reduxjs/toolkit";
import authReducer from "../src/store/authSlice";
import feedReducer from "../src/store/feedSlice";
import uiReducer from "../src/store/uiSlice";
import pendingReducer from "../src/store/pendingSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  feed: feedReducer,
  ui: uiReducer,
  pending: pendingReducer,
});

type PreloadedState = Parameters<typeof configureStore<ReturnType<typeof rootReducer>>>[0]["preloadedState"];

export interface StoreOptions {
  /** Seed slice state at construction (e.g. an authed user). */
  preloadedState?: PreloadedState;
  /** Actions to dispatch immediately after the store is built (e.g. queue a toast). */
  actions?: Action[];
}

/**
 * Build a fresh Redux store for a story so state doesn't leak across stories.
 */
export function makeMockStore(options?: StoreOptions) {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: options?.preloadedState,
  });
  options?.actions?.forEach((action) => store.dispatch(action));
  return store;
}
