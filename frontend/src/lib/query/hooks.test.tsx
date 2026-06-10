import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import authReducer, { checkAuth } from "../../store/authSlice";
import feedReducer from "../../store/feedSlice";
import type { User } from "../../services/types";
import type * as ApiModule from "../../services/api";

// `useFeed` picks its endpoint from auth state, so the api layer is mocked to
// observe which one it calls under each auth condition. `importOriginal` keeps
// every other export intact (hooks.ts pulls many names from this module).
const fetchHomeFeed = vi.fn(async () => ({ occurrences: [], cursor: undefined }));
const fetchExploreFeed = vi.fn(async () => ({ occurrences: [], cursor: undefined }));
vi.mock("../../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  fetchHomeFeed: (...args: unknown[]) => fetchHomeFeed(...args),
  fetchExploreFeed: (...args: unknown[]) => fetchExploreFeed(...args),
}));

// Imported after the mock is registered so the hook closes over the stubs.
import { useFeed } from "./hooks";
import { qk } from "./keys";

const TEST_USER: User = { did: "did:plc:tester", handle: "tester.example" };

// A fresh store starts at { user: null, isLoading: true } — exactly the
// startup state before the `checkAuth` round-trip resolves.
function makeStore() {
  return configureStore({ reducer: { auth: authReducer, feed: feedReducer } });
}

type Store = ReturnType<typeof makeStore>;

// `checkAuth.fulfilled(payload)` is the same action the real thunk dispatches
// when the session check returns: it sets `user` and clears `isLoading`.
function resolveAuth(store: Store, user: User | null) {
  act(() => {
    store.dispatch(checkAuth.fulfilled(user, "req"));
  });
}

function wrapper(store: Store, client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Provider>
  );
}

function makeClient() {
  // Retries off so a rejected query fails fast instead of stalling the test.
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("useFeed", () => {
  beforeEach(() => {
    fetchHomeFeed.mockClear();
    fetchExploreFeed.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("fetches nothing until the startup auth check resolves", async () => {
    const store = makeStore(); // isLoading: true
    renderHook(() => useFeed("home"), { wrapper: wrapper(store, makeClient()) });

    // Give React Query a turn; the query must stay disabled while auth loads,
    // so a logged-in user never fires a throwaway explore request that would
    // get cached under the home key.
    await Promise.resolve();
    expect(fetchHomeFeed).not.toHaveBeenCalled();
    expect(fetchExploreFeed).not.toHaveBeenCalled();
  });

  it("fetches the home endpoint for a signed-in home tab", async () => {
    const store = makeStore();
    resolveAuth(store, TEST_USER);
    renderHook(() => useFeed("home"), { wrapper: wrapper(store, makeClient()) });

    await waitFor(() => expect(fetchHomeFeed).toHaveBeenCalledTimes(1));
    expect(fetchExploreFeed).not.toHaveBeenCalled();
  });

  it("falls back to the explore endpoint for a signed-out home tab", async () => {
    const store = makeStore();
    resolveAuth(store, null);
    renderHook(() => useFeed("home"), { wrapper: wrapper(store, makeClient()) });

    await waitFor(() => expect(fetchExploreFeed).toHaveBeenCalledTimes(1));
    expect(fetchHomeFeed).not.toHaveBeenCalled();
  });

  // The core regression: when auth flips false -> true the home tab must
  // refetch the home endpoint, not keep serving the explore data it cached
  // during the unauthenticated window. This only holds because the query key
  // includes `isAuthenticated`.
  it("refetches the home endpoint when auth flips from out to in", async () => {
    const store = makeStore();
    const client = makeClient();
    resolveAuth(store, null); // resolved, signed out
    renderHook(() => useFeed("home"), { wrapper: wrapper(store, client) });

    await waitFor(() => expect(fetchExploreFeed).toHaveBeenCalledTimes(1));
    expect(fetchHomeFeed).not.toHaveBeenCalled();

    resolveAuth(store, TEST_USER); // now signed in

    await waitFor(() => expect(fetchHomeFeed).toHaveBeenCalledTimes(1));
    // The explore response is NOT reused for the signed-in home view.
    expect(fetchExploreFeed).toHaveBeenCalledTimes(1);
  });

  it("keys home feeds separately by auth state", () => {
    // Same tab + filters but different auth => distinct cache entries, so an
    // explore response can never masquerade as the signed-in home feed.
    const signedOut = qk.feed("home", {}, false);
    const signedIn = qk.feed("home", {}, true);
    expect(signedOut).not.toEqual(signedIn);
    // The shared "feed" tag is preserved so the like-patcher still matches.
    expect(signedOut[0]).toBe("feed");
    expect(signedIn[0]).toBe("feed");
  });
});
