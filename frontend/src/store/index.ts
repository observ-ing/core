import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import authReducer from "./authSlice";
import feedReducer from "./feedSlice";
import uiReducer from "./uiSlice";
import pendingReducer from "./pendingSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  feed: feedReducer,
  ui: uiReducer,
  pending: pendingReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

/** Builds a store like the app's; tests and stories make a fresh one each. */
export function makeStore(preloadedState: Partial<RootState> = {}) {
  return configureStore({ reducer: rootReducer, preloadedState });
}

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore["dispatch"];

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
