import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import uiReducer, {
  openLoginModal,
  closeLoginModal,
  openUploadModal,
  openEditModal,
  closeUploadModal,
  openDeleteConfirm,
  closeDeleteConfirm,
  addToast,
  removeToast,
  setCurrentLocation,
  setThemeMode,
  updateSystemTheme,
} from "./uiSlice";
import type { Occurrence } from "../services/types";

describe("uiSlice", () => {
  const createTestStore = () =>
    configureStore({
      reducer: { ui: uiReducer },
    });

  const mockOccurrence: Occurrence = {
    uri: "at://did:plc:test/org.rwell.test.occurrence/123",
    cid: "cid123",
    indexedAt: "2024-01-15T12:00:00Z",
    createdAt: "2024-01-15T12:00:00Z",
    observer: {
      did: "did:plc:test",
      handle: "test.bsky.social",
      displayName: "Test User",
      avatar: null,
    },
    subjects: [],
    communityId: null,
    researchGrade: false,
    effectiveTaxonomy: null,
    identificationCount: 0,
    commentCount: 0,
    likeCount: 0,
    images: [],
    location: {
      decimalLatitude: 40.7128,
      decimalLongitude: -74.006,
    },
    eventDate: "2024-01-15",
  };

  let localStorageMock: { [key: string]: string };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = {};

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
    });

    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("login modal", () => {
    it("opens login modal", () => {
      const store = createTestStore();
      store.dispatch(openLoginModal());

      expect(store.getState().ui.loginModalOpen).toBe(true);
    });

    it("closes login modal", () => {
      const store = createTestStore();
      store.dispatch(openLoginModal());
      store.dispatch(closeLoginModal());

      expect(store.getState().ui.loginModalOpen).toBe(false);
    });
  });

  describe("upload modal", () => {
    it("opens upload modal for new occurrence", () => {
      const store = createTestStore();
      store.dispatch(openUploadModal());

      const state = store.getState().ui;
      expect(state.uploadModalOpen).toBe(true);
      expect(state.editingObservation).toBeNull();
    });

    it("opens edit modal with occurrence", () => {
      const store = createTestStore();
      store.dispatch(openEditModal(mockOccurrence));

      const state = store.getState().ui;
      expect(state.uploadModalOpen).toBe(true);
      expect(state.editingObservation).toEqual(mockOccurrence);
    });

    it("clears editing occurrence when opening for new upload", () => {
      const store = createTestStore();
      store.dispatch(openEditModal(mockOccurrence));
      store.dispatch(openUploadModal());

      expect(store.getState().ui.editingObservation).toBeNull();
    });

    it("closes upload modal and clears editing occurrence", () => {
      const store = createTestStore();
      store.dispatch(openEditModal(mockOccurrence));
      store.dispatch(closeUploadModal());

      const state = store.getState().ui;
      expect(state.uploadModalOpen).toBe(false);
      expect(state.editingObservation).toBeNull();
    });
  });

  describe("delete confirm", () => {
    it("opens delete confirm with occurrence", () => {
      const store = createTestStore();
      store.dispatch(openDeleteConfirm(mockOccurrence));

      expect(store.getState().ui.deleteConfirmObservation).toEqual(mockOccurrence);
    });

    it("closes delete confirm", () => {
      const store = createTestStore();
      store.dispatch(openDeleteConfirm(mockOccurrence));
      store.dispatch(closeDeleteConfirm());

      expect(store.getState().ui.deleteConfirmObservation).toBeNull();
    });
  });

  describe("toasts", () => {
    it("adds success toast", () => {
      const store = createTestStore();
      store.dispatch(addToast({ message: "Success!", type: "success" }));

      const toasts = store.getState().ui.toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe("Success!");
      expect(toasts[0].type).toBe("success");
      expect(toasts[0].id).toBeDefined();
    });

    it("adds error toast", () => {
      const store = createTestStore();
      store.dispatch(addToast({ message: "Error occurred", type: "error" }));

      const toasts = store.getState().ui.toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
    });

    it("adds multiple toasts", () => {
      const store = createTestStore();
      store.dispatch(addToast({ message: "First", type: "success" }));
      store.dispatch(addToast({ message: "Second", type: "error" }));

      expect(store.getState().ui.toasts).toHaveLength(2);
    });

    it("removes toast by id", () => {
      const store = createTestStore();
      store.dispatch(addToast({ message: "Toast 1", type: "success" }));

      const toastsBefore = store.getState().ui.toasts;
      expect(toastsBefore).toHaveLength(1);

      const toastId = toastsBefore[0].id;
      store.dispatch(removeToast(toastId));

      const toastsAfter = store.getState().ui.toasts;
      expect(toastsAfter).toHaveLength(0);
    });

    it("handles removing non-existent toast id", () => {
      const store = createTestStore();
      store.dispatch(addToast({ message: "Toast", type: "success" }));
      store.dispatch(removeToast("non-existent-id"));

      expect(store.getState().ui.toasts).toHaveLength(1);
    });
  });

  describe("current location", () => {
    it("sets current location", () => {
      const store = createTestStore();
      const location = { lat: 40.7128, lng: -74.006 };
      store.dispatch(setCurrentLocation(location));

      expect(store.getState().ui.currentLocation).toEqual(location);
    });

    it("clears current location with null", () => {
      const store = createTestStore();
      store.dispatch(setCurrentLocation({ lat: 40, lng: -74 }));
      store.dispatch(setCurrentLocation(null));

      expect(store.getState().ui.currentLocation).toBeNull();
    });
  });

  describe("theme", () => {
    it("sets theme mode to dark", () => {
      const store = createTestStore();
      store.dispatch(setThemeMode("dark"));

      const state = store.getState().ui;
      expect(state.themeMode).toBe("dark");
      expect(state.effectiveTheme).toBe("dark");
      expect(localStorage.setItem).toHaveBeenCalledWith("observing-theme-mode", "dark");
    });

    it("sets theme mode to light", () => {
      const store = createTestStore();
      store.dispatch(setThemeMode("light"));

      const state = store.getState().ui;
      expect(state.themeMode).toBe("light");
      expect(state.effectiveTheme).toBe("light");
    });

    it("sets theme mode to system", () => {
      const store = createTestStore();
      store.dispatch(setThemeMode("system"));

      const state = store.getState().ui;
      expect(state.themeMode).toBe("system");
      // effectiveTheme depends on system preference
      // Since we're testing the action, just verify it's a valid theme
      expect(["light", "dark"]).toContain(state.effectiveTheme);
    });

    it("updateSystemTheme updates effective theme when mode is system", () => {
      const store = createTestStore();
      store.dispatch(setThemeMode("system"));

      // Change system preference to dark
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
        matches: true, // dark mode
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      store.dispatch(updateSystemTheme());

      expect(store.getState().ui.effectiveTheme).toBe("dark");
    });

    it("updateSystemTheme does nothing when mode is not system", () => {
      const store = createTestStore();
      store.dispatch(setThemeMode("light"));

      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
        matches: true, // dark mode
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      store.dispatch(updateSystemTheme());

      // Should remain light, not switch to dark
      expect(store.getState().ui.effectiveTheme).toBe("light");
    });

    it("persists theme to localStorage", () => {
      const store = createTestStore();
      store.dispatch(setThemeMode("dark"));

      expect(localStorage.setItem).toHaveBeenCalledWith("observing-theme-mode", "dark");
    });
  });
});
