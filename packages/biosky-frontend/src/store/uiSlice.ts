import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Occurrence } from "../services/types";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

interface UIState {
  loginModalOpen: boolean;
  uploadModalOpen: boolean;
  editingOccurrence: Occurrence | null;
  toasts: Toast[];
  currentLocation: { lat: number; lng: number } | null;
}

const initialState: UIState = {
  loginModalOpen: false,
  uploadModalOpen: false,
  editingOccurrence: null,
  toasts: [],
  currentLocation: null,
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
      state.editingOccurrence = null;
    },
    openEditModal: (state, action: PayloadAction<Occurrence>) => {
      state.uploadModalOpen = true;
      state.editingOccurrence = action.payload;
    },
    closeUploadModal: (state) => {
      state.uploadModalOpen = false;
      state.editingOccurrence = null;
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
  },
});

export const {
  openLoginModal,
  closeLoginModal,
  openUploadModal,
  openEditModal,
  closeUploadModal,
  addToast,
  removeToast,
  setCurrentLocation,
} = uiSlice.actions;

export default uiSlice.reducer;
