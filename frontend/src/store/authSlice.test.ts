import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeStore } from "./index";
import { checkAuth, logout } from "./authSlice";

vi.mock("../services/api", () => ({
  checkAuth: vi.fn(),
  logout: vi.fn(),
}));

import * as api from "../services/api";

describe("authSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has correct initial state", () => {
      const store = makeStore();
      const state = store.getState().auth;

      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(true);
    });
  });

  describe("checkAuth thunk", () => {
    it("sets isLoading to true when pending", () => {
      const store = makeStore();

      // Dispatch but don't await - we want to check pending state
      vi.mocked(api.checkAuth).mockReturnValue(new Promise(() => {}));
      store.dispatch(checkAuth());

      const state = store.getState().auth;
      expect(state.isLoading).toBe(true);
    });

    it("sets user and isLoading false when fulfilled", async () => {
      const mockUser = {
        did: "did:plc:test123",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://example.com/avatar.jpg",
      };
      vi.mocked(api.checkAuth).mockResolvedValue(mockUser);

      const store = makeStore();
      await store.dispatch(checkAuth());

      const state = store.getState().auth;
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
    });

    it("sets user to null and isLoading false when rejected", async () => {
      vi.mocked(api.checkAuth).mockRejectedValue(new Error("Not authenticated"));

      const store = makeStore();
      await store.dispatch(checkAuth());

      const state = store.getState().auth;
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it("handles null user response (not logged in)", async () => {
      vi.mocked(api.checkAuth).mockResolvedValue(null);

      const store = makeStore();
      await store.dispatch(checkAuth());

      const state = store.getState().auth;
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });

  describe("logout thunk", () => {
    it("clears user when fulfilled", async () => {
      const mockUser = {
        did: "did:plc:test123",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: null,
      };
      vi.mocked(api.checkAuth).mockResolvedValue(mockUser);
      vi.mocked(api.logout).mockResolvedValue(undefined);

      const store = makeStore();

      // First login
      await store.dispatch(checkAuth());
      expect(store.getState().auth.user).toEqual(mockUser);

      // Then logout
      await store.dispatch(logout());
      expect(store.getState().auth.user).toBeNull();
    });

    it("calls api.logout", async () => {
      vi.mocked(api.logout).mockResolvedValue(undefined);

      const store = makeStore();
      await store.dispatch(logout());

      expect(api.logout).toHaveBeenCalled();
    });
  });
});
