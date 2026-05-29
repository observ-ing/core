import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAutocomplete } from "./useAutocomplete";

describe("useAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call searchFn when the query is below minLength", async () => {
    const searchFn = vi.fn().mockResolvedValue(["never"]);
    const { result } = renderHook(() =>
      useAutocomplete({ searchFn, minLength: 2, debounceMs: 100 }),
    );

    act(() => result.current.handleSearch("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(searchFn).not.toHaveBeenCalled();
    expect(result.current.options).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("calls searchFn after the debounce window and sets the results", async () => {
    const searchFn = vi.fn().mockResolvedValue(["alpha", "beta"]);
    const { result } = renderHook(() =>
      useAutocomplete({ searchFn, minLength: 2, debounceMs: 100 }),
    );

    act(() => result.current.handleSearch("oa"));
    // loading flips on synchronously
    expect(result.current.loading).toBe(true);
    expect(searchFn).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    await waitFor(() => {
      expect(result.current.options).toEqual(["alpha", "beta"]);
    });
    expect(result.current.loading).toBe(false);
    expect(searchFn).toHaveBeenCalledExactlyOnceWith("oa");
  });

  it("applies filterResults when provided", async () => {
    const searchFn = vi.fn().mockResolvedValue(["alpha", "beta", "gamma"]);
    const filterResults = (r: string[]) => r.filter((s) => s.startsWith("a") || s.startsWith("b"));
    const { result } = renderHook(() =>
      useAutocomplete({ searchFn, filterResults, minLength: 1, debounceMs: 50 }),
    );

    act(() => result.current.handleSearch("x"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    await waitFor(() => {
      expect(result.current.options).toEqual(["alpha", "beta"]);
    });
  });

  it("drops the result of an outdated query when a newer one is in flight", async () => {
    // searchFn returns different results based on query — the older "oa"
    // result must be discarded because by the time it settles, the
    // user has typed "oak" and the hook is waiting on that one.
    const searchFn = vi.fn(async (q: string) => {
      if (q === "oa") return ["acorn-old"];
      if (q === "oak") return ["oak-new"];
      return [];
    });

    const { result } = renderHook(() =>
      useAutocomplete({ searchFn, minLength: 2, debounceMs: 100 }),
    );

    // First query lands its timer, kicks off the fetch (microtask is pending).
    act(() => result.current.handleSearch("oa"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Before the microtask flushes, replace with a new query — this clears
    // the in-flight timer, but the awaiting promise for "oa" is already
    // resolving. The latestQuery guard must discard its result.
    act(() => result.current.handleSearch("oak"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    await waitFor(() => {
      expect(result.current.options).toEqual(["oak-new"]);
    });
    // Should never have written "acorn-old".
    expect(result.current.options).not.toContain("acorn-old");
  });

  it("cancels a pending debounce when a shorter query is entered", async () => {
    const searchFn = vi.fn().mockResolvedValue(["never"]);
    const { result } = renderHook(() =>
      useAutocomplete({ searchFn, minLength: 2, debounceMs: 100 }),
    );

    act(() => result.current.handleSearch("ab"));
    // Before the debounce fires, drop below minLength
    act(() => result.current.handleSearch("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(searchFn).not.toHaveBeenCalled();
    expect(result.current.options).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("clearOptions wipes options and loading regardless of pending timer", async () => {
    const searchFn = vi.fn().mockResolvedValue(["x"]);
    const { result } = renderHook(() =>
      useAutocomplete({ searchFn, minLength: 1, debounceMs: 100 }),
    );

    act(() => result.current.handleSearch("aa"));
    expect(result.current.loading).toBe(true);

    act(() => result.current.clearOptions());
    expect(result.current.options).toEqual([]);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    // searchFn should not have run because clearOptions wiped the timer.
    expect(searchFn).not.toHaveBeenCalled();
  });
});
