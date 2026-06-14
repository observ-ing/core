import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { User } from "../services/types";
import * as api from "../services/api";
import { clearQueryCache } from "../lib/query/queryClient";

// Auth holds only the session (the viewer gate). User preferences are server
// state and live in the TanStack Query cache (lib/query `useUserPreferences` /
// `useUpdatePreferences`).
interface AuthState {
  user: User | null;
  isLoading: boolean;
}

const initialState: AuthState = {
  user: null,
  isLoading: true,
};

export const checkAuth = createAsyncThunk("auth/checkAuth", async () => {
  return api.checkAuth();
});

export const logout = createAsyncThunk("auth/logout", async () => {
  await api.logout();
  // Drop all cached per-user server state so the next viewer on this device
  // can't see the previous one's likes/feeds/notifications/preferences.
  clearQueryCache();
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {},
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
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
      });
  },
});

export default authSlice.reducer;
