import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, renderHook } from "@testing-library/react";
import { useToast } from "./useToast";
import uiReducer from "../store/uiSlice";
import authReducer from "../store/authSlice";
import feedReducer from "../store/feedSlice";

function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, feed: feedReducer, ui: uiReducer },
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
}

describe("useToast", () => {
  it("dispatches a success toast", () => {
    const store = makeStore();
    const { result } = renderHook(() => useToast(), { wrapper: wrapper(store) });

    act(() => {
      result.current.success("Saved!");
    });

    const toasts = store.getState().ui.toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: "Saved!", type: "success" });
  });

  it("dispatches an error toast", () => {
    const store = makeStore();
    const { result } = renderHook(() => useToast(), { wrapper: wrapper(store) });

    act(() => {
      result.current.error("Boom");
    });

    const toasts = store.getState().ui.toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: "Boom", type: "error" });
  });

  it("dispatches via show with an explicit type", () => {
    const store = makeStore();
    const { result } = renderHook(() => useToast(), { wrapper: wrapper(store) });

    act(() => {
      result.current.show("Hello", "success");
    });

    const toasts = store.getState().ui.toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: "Hello", type: "success" });
  });

  it("returns a stable object across renders", () => {
    const store = makeStore();
    const { result, rerender } = renderHook(() => useToast(), { wrapper: wrapper(store) });

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
