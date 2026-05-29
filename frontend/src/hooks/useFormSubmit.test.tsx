import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useFormSubmit } from "./useFormSubmit";
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

describe("useFormSubmit", () => {
  it("toggles isSubmitting around the submit call", async () => {
    const store = makeStore();
    let resolveSubmit: (() => void) | undefined;
    const submitFn = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveSubmit = r;
        }),
    );

    const { result } = renderHook(() => useFormSubmit(submitFn), { wrapper: wrapper(store) });

    expect(result.current.isSubmitting).toBe(false);
    act(() => {
      result.current.handleSubmit();
    });
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveSubmit?.();
      // flush microtasks
    });

    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(false);
    });
    expect(submitFn).toHaveBeenCalledTimes(1);
  });

  it("guards against double-submit on rapid handleSubmit calls", async () => {
    const store = makeStore();
    let resolveSubmit: (() => void) | undefined;
    const submitFn = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveSubmit = r;
        }),
    );

    const { result } = renderHook(() => useFormSubmit(submitFn), { wrapper: wrapper(store) });

    act(() => {
      result.current.handleSubmit();
      // Second call while the first is still in flight — must be ignored.
      result.current.handleSubmit();
      result.current.handleSubmit();
    });

    expect(submitFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubmit?.();
    });

    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(false);
    });
  });

  it("dispatches a success toast when successMessage is set", async () => {
    const store = makeStore();
    const submitFn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFormSubmit(submitFn, { successMessage: "Saved!" }), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    const toasts = store.getState().ui.toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: "Saved!", type: "success" });
  });

  it("does not dispatch a success toast when successMessage is omitted", async () => {
    const store = makeStore();
    const submitFn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFormSubmit(submitFn), { wrapper: wrapper(store) });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(store.getState().ui.toasts).toHaveLength(0);
  });

  it("calls onSuccess after a successful submission", async () => {
    const store = makeStore();
    const submitFn = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useFormSubmit(submitFn, { onSuccess }), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("dispatches an error toast on the default error path", async () => {
    const store = makeStore();
    const submitFn = vi.fn().mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useFormSubmit(submitFn), { wrapper: wrapper(store) });

    await act(async () => {
      await result.current.handleSubmit();
    });

    const toasts = store.getState().ui.toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: "Error: boom", type: "error" });
    expect(result.current.isSubmitting).toBe(false);
  });

  it("uses a custom onError instead of dispatching a toast", async () => {
    const store = makeStore();
    const submitFn = vi.fn().mockRejectedValue(new Error("boom"));
    const onError = vi.fn();

    const { result } = renderHook(() => useFormSubmit(submitFn, { onError }), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    // Default toast must NOT also fire when onError is provided.
    expect(store.getState().ui.toasts).toHaveLength(0);
  });

  it("clears the in-flight guard after an error so the next submit can run", async () => {
    const store = makeStore();
    const submitFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useFormSubmit(submitFn), { wrapper: wrapper(store) });

    await act(async () => {
      await result.current.handleSubmit();
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(submitFn).toHaveBeenCalledTimes(2);
  });
});
