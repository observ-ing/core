import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { PaletteMode } from "@mui/material";
import type { Occurrence } from "../services/types";

const THEME_STORAGE_KEY = "observing-theme-mode";

type ThemeMode = PaletteMode | "system";

function getSystemTheme(): PaletteMode {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") {
    return stored;
  }
  return "system";
}

function getEffectiveTheme(mode: ThemeMode): PaletteMode {
  return mode === "system" ? getSystemTheme() : mode;
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

interface UIState {
  loginModalOpen: boolean;
  uploadModalOpen: boolean;
  editingObservation: Occurrence | null;
  deleteConfirmObservation: Occurrence | null;
  toasts: Toast[];
  currentLocation: { lat: number; lng: number } | null;
  themeMode: ThemeMode;
  effectiveTheme: PaletteMode;
}

const storedTheme = getStoredTheme();

const initialState: UIState = {
  loginModalOpen: false,
  uploadModalOpen: false,
  editingObservation: null,
  deleteConfirmObservation: null,
  toasts: [],
  currentLocation: null,
  themeMode: storedTheme,
  effectiveTheme: getEffectiveTheme(storedTheme),
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    openLoginModal: (state) => {
      state.loginModalOpen = true;
    },
    closeLoginModal: (state) => {
      state.loginModalOpen = false;
    },
    openUploadModal: (state) => {
      state.uploadModalOpen = true;
      state.editingObservation = null;
    },
    openEditModal: (state, action: PayloadAction<Occurrence>) => {
      state.uploadModalOpen = true;
      state.editingObservation = action.payload;
    },
    closeUploadModal: (state) => {
      state.uploadModalOpen = false;
      state.editingObservation = null;
    },
    openDeleteConfirm: (state, action: PayloadAction<Occurrence>) => {
      state.deleteConfirmObservation = action.payload;
    },
    closeDeleteConfirm: (state) => {
      state.deleteConfirmObservation = null;
    },
    addToast: (
      state,
      action: PayloadAction<{ message: string; type: "success" | "error" }>
    ) => {
      state.toasts.push({
        id: Date.now().toString(),
        ...action.payload,
      });
    },
    removeToast: (state, action: PayloadAction<string>) => {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    setCurrentLocation: (
      state,
      action: PayloadAction<{ lat: number; lng: number } | null>
    ) => {
      state.currentLocation = action.payload;
    },
    setThemeMode: (state, action: PayloadAction<ThemeMode>) => {
      state.themeMode = action.payload;
      state.effectiveTheme = getEffectiveTheme(action.payload);
      localStorage.setItem(THEME_STORAGE_KEY, action.payload);
    },
    updateSystemTheme: (state) => {
      if (state.themeMode === "system") {
        state.effectiveTheme = getSystemTheme();
      }
    },
  },
});

export const {
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
} = uiSlice.actions;

export type { ThemeMode };

export default uiSlice.reducer;
