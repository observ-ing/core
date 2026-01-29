import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider, CssBaseline, Box } from "@mui/material";
import { getTheme } from "./theme";
import { store, useAppDispatch, useAppSelector } from "./store";
import { checkAuth } from "./store/authSlice";
import { updateSystemTheme } from "./store/uiSlice";
import { Sidebar, DRAWER_WIDTH } from "./components/layout/Sidebar";
import { FeedView } from "./components/feed/FeedView";
import { ObservationDetail } from "./components/observation/ObservationDetail";
import { ProfileView } from "./components/profile/ProfileView";
import { TaxonDetail } from "./components/taxon/TaxonDetail";
import { LoginModal } from "./components/modals/LoginModal";
import { UploadModal } from "./components/modals/UploadModal";
import { DeleteConfirmDialog } from "./components/modals/DeleteConfirmDialog";
import { FAB } from "./components/common/FAB";
import { ToastContainer } from "./components/common/Toast";
import { NotFound } from "./components/common/NotFound";
import "./styles/global.css";

function AppContent() {
  const dispatch = useAppDispatch();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  useEffect(() => {
    dispatch(checkAuth());
  }, [dispatch]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      dispatch(updateSystemTheme());
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [dispatch]);

  return (
    <BrowserRouter>
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar mobileOpen={mobileOpen} onMobileClose={handleDrawerToggle} />
        <Box
          component="main"
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          }}
        >
          <Routes>
            <Route path="/" element={<FeedView tab="home" />} />
            <Route path="/explore" element={<FeedView tab="explore" />} />
            <Route path="/observation/:uri" element={<ObservationDetail />} />
            <Route path="/profile/:did" element={<ProfileView />} />
            <Route path="/taxon/:kingdom/:name" element={<TaxonDetail />} />
            <Route path="/taxon/:id" element={<TaxonDetail />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Box>
      </Box>
      <FAB />
      <LoginModal />
      <UploadModal />
      <DeleteConfirmDialog />
      <ToastContainer />
    </BrowserRouter>
  );
}

function ThemedApp() {
  const effectiveTheme = useAppSelector((state) => state.ui.effectiveTheme);
  const theme = useMemo(() => getTheme(effectiveTheme), [effectiveTheme]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppContent />
    </ThemeProvider>
  );
}

export function App() {
  return (
    <Provider store={store}>
      <ThemedApp />
    </Provider>
  );
}
