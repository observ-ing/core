import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { User } from "../services/types";
import * as api from "../services/api";
import { clearQueryCache } from "../lib/query/queryClient";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  defaultLicense: string | null;
}

const initialState: AuthState = {
  user: null,
  isLoading: true,
  defaultLicense: null,
};

export const checkAuth = createAsyncThunk("auth/checkAuth", async () => {
  return api.checkAuth();
});

export const loadUserPreferences = createAsyncThunk("auth/loadUserPreferences", async () => {
  return api.fetchUserPreferences();
});

export const logout = createAsyncThunk("auth/logout", async () => {
  await api.logout();
  // Drop all cached per-user server state so the next viewer on this device
  // can't see the previous one's likes/feeds/notifications.
  await clearQueryCache();
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setDefaultLicense: (state, action: PayloadAction<string | null>) => {
      state.defaultLicense = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkAuth.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(checkAuth.fulfilled, (state, action) => {
        state.user = action.payload;
        state.isLoading = false;
      })
      .addCase(checkAuth.rejected, (state) => {
        state.user = null;
        state.isLoading = false;
      })
      .addCase(loadUserPreferences.fulfilled, (state, action) => {
        state.defaultLicense = action.payload.defaultLicense ?? null;
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.defaultLicense = null;
      });
  },
});

export const { setDefaultLicense } = authSlice.actions;

export default authSlice.reducer;
