import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import authReducer, { checkAuth } from "../../store/authSlice";
import feedReducer from "../../store/feedSlice";
import pendingReducer from "../../store/pendingSlice";
import type { Occurrence, Profile, User } from "../../services/types";
import type * as ApiModule from "../../services/api";

// `useFeed` picks its endpoint from auth state, so the api layer is mocked to
// observe which one it calls under each auth condition. `importOriginal` keeps
// every other export intact (hooks.ts pulls many names from this module).
const SERVER_URI = "at://did:plc:tester/bio.lexicons.temp.v0-1.occurrence/ingested";
const serverRow = (): Occurrence => ({
  uri: SERVER_URI,
  cid: "bafyserver",
  observer: { did: "did:plc:tester", handle: "tester.example" },
  identificationCount: 0,
  images: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  qualityIssues: [],
});
const fetchHomeFeed = vi.fn(async () => ({ occurrences: [serverRow()], cursor: undefined }));
const fetchExploreFeed = vi.fn(async () => ({ occurrences: [serverRow()], cursor: undefined }));
const fetchObservation = vi.fn(async () => null);
vi.mock("../../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  fetchHomeFeed: (...args: unknown[]) => fetchHomeFeed(...args),
  fetchExploreFeed: (...args: unknown[]) => fetchExploreFeed(...args),
  fetchObservation: (...args: unknown[]) => fetchObservation(...args),
}));

// Imported after the mock is registered so the hook closes over the stubs.
import { useFeed, useObservation } from "./hooks";
import { makeTombstoneOccurrence } from "./occurrenceCache";
import { trackSubmission } from "../../store/pendingSlice";
import { qk } from "./keys";
import uiReducer, { startDeletingObservation } from "../../store/uiSlice";

const TEST_USER: User = { did: "did:plc:tester", handle: "tester.example" };

// A fresh store starts at { user: null, isLoading: true } — exactly the
// startup state before the `checkAuth` round-trip resolves. `pending` is here
// because `useFeed` reads the optimistic-row overlay out of it.
function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, feed: feedReducer, pending: pendingReducer },
  });
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

  // The read-your-writes bridge, at the layer that renders it. A row the author
  // just submitted is not in the server's answer (the appview is read-only on
  // the ingester schema), so it is layered on in `select` — and stays layered on
  // whatever happens to the cached pages underneath.
  describe("pending overlay", () => {
    const PENDING_URI = "at://did:plc:tester/bio.lexicons.temp.v0-1.occurrence/new";

    function pendingRow(observer: Profile): Occurrence {
      return makeTombstoneOccurrence({
        uri: PENDING_URI,
        cid: "bafypending",
        observer,
        latitude: 1,
        longitude: 2,
        imageUrls: [],
        createdAt: new Date().toISOString(),
      });
    }

    /** Put a row in the pending slice the way a fresh submission does. */
    function submit(store: Store, observer: Profile) {
      act(() => {
        store.dispatch(
          trackSubmission.pending("req", {
            uri: PENDING_URI,
            cid: "bafypending",
            kind: "create",
            occurrence: pendingRow(observer),
          }),
        );
      });
    }

    it("shows the viewer their own not-yet-ingested row above the server's", async () => {
      const store = makeStore();
      resolveAuth(store, TEST_USER);
      submit(store, TEST_USER);

      const { result } = renderHook(() => useFeed("home"), {
        wrapper: wrapper(store, makeClient()),
      });

      await waitFor(() => expect(result.current.data).toBeDefined());
      const uris = result.current.data?.pages.flatMap((p) => p.occurrences.map((o) => o.uri));
      expect(uris).toEqual([PENDING_URI, SERVER_URI]);
    });

    it("does not show one author's pending row to another viewer", async () => {
      const store = makeStore();
      resolveAuth(store, TEST_USER);
      submit(store, { did: "did:plc:someone-else", handle: "else.example" });

      const { result } = renderHook(() => useFeed("home"), {
        wrapper: wrapper(store, makeClient()),
      });

      await waitFor(() => expect(result.current.data).toBeDefined());
      const uris = result.current.data?.pages.flatMap((p) => p.occurrences.map((o) => o.uri));
      expect(uris).toEqual([SERVER_URI]);
    });

    // The server's copy wins the moment it exists: the two must never both
    // render, or the author sees their observation twice.
    it("drops the pending row once the server returns that uri", async () => {
      const store = makeStore();
      resolveAuth(store, TEST_USER);
      submit(store, TEST_USER);
      fetchHomeFeed.mockResolvedValueOnce({
        occurrences: [{ ...pendingRow(TEST_USER), cid: "bafyingested" }],
        cursor: undefined,
      });

      const { result } = renderHook(() => useFeed("home"), {
        wrapper: wrapper(store, makeClient()),
      });

      await waitFor(() => expect(result.current.data).toBeDefined());
      const rows = result.current.data?.pages.flatMap((p) => p.occurrences) ?? [];
      expect(rows.map((o) => o.uri)).toEqual([PENDING_URI]);
      expect(rows[0]?.cid).toBe("bafyingested");
    });
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

// The detail query must go quiet the instant a delete for that observation
// starts. Otherwise the delete mutation's `removeQueries` runs while this
// query still has an active observer, React Query refetches to repopulate it,
// and the request hits the now-deleted row -> a 404 in the gap before the
// detail page navigates away. `useObservation` gates `enabled` on
// `ui.deletingObservationUri`.
describe("useObservation", () => {
  const URI = "at://did:plc:tester/bio.lexicons.temp.v0-1.occurrence/abc";

  function makeUiStore() {
    return configureStore({ reducer: { ui: uiReducer } });
  }

  function uiWrapper(store: ReturnType<typeof makeUiStore>, client: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
  }

  beforeEach(() => {
    fetchObservation.mockClear();
  });

  it("fetches the observation when no delete is in progress", async () => {
    const store = makeUiStore();
    renderHook(() => useObservation(URI), { wrapper: uiWrapper(store, makeClient()) });

    await waitFor(() => expect(fetchObservation).toHaveBeenCalledTimes(1));
    expect(fetchObservation).toHaveBeenCalledWith(URI);
  });

  it("does not fetch while that observation is being deleted", async () => {
    const store = makeUiStore();
    store.dispatch(startDeletingObservation(URI));
    renderHook(() => useObservation(URI), { wrapper: uiWrapper(store, makeClient()) });

    // Give React Query a turn; the query must stay disabled, so no refetch of
    // the row the delete is about to remove.
    await Promise.resolve();
    expect(fetchObservation).not.toHaveBeenCalled();
  });

  it("still fetches when a different observation is being deleted", async () => {
    const store = makeUiStore();
    store.dispatch(
      startDeletingObservation("at://did:plc:other/bio.lexicons.temp.v0-1.occurrence/zzz"),
    );
    renderHook(() => useObservation(URI), { wrapper: uiWrapper(store, makeClient()) });

    await waitFor(() => expect(fetchObservation).toHaveBeenCalledTimes(1));
  });
});
