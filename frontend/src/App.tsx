import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider, CssBaseline, Box, Alert } from "@mui/material";
import { getTheme } from "./theme";
import { store, useAppDispatch, useAppSelector } from "./store";
import { checkAuth } from "./store/authSlice";
import { updateSystemTheme } from "./store/uiSlice";
import { fetchUnreadCount } from "./services/api";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { LandingPage } from "./components/landing/LandingPage";
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
import { LexiconView } from "./components/lexicon/LexiconView";
import { NotificationsPage } from "./components/notifications/NotificationsPage";
import "./styles/global.css";

function AppContent() {
  const dispatch = useAppDispatch();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const user = useAppSelector((state) => state.auth.user);
  const isAuthLoading = useAppSelector((state) => state.auth.isLoading);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleDrawerOpen = () => setMobileOpen(true);
  const handleDrawerClose = () => setMobileOpen(false);

  useEffect(() => {
    dispatch(checkAuth());
  }, [dispatch]);

  // Poll unread notification count
  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    const poll = () => {
      fetchUnreadCount()
        .then((data) => setUnreadCount(data.count))
        .catch(() => {});
    };
    poll();
    intervalRef.current = setInterval(poll, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      dispatch(updateSystemTheme());
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [dispatch]);

  const location = useLocation();
  const showLanding = !user && !isAuthLoading && location.pathname === "/";

  return (
    <Box sx={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      {!showLanding && (
        <>
          <TopBar onMobileMenuClick={handleDrawerOpen} unreadCount={unreadCount} />
          <Alert
            severity="warning"
            sx={{
              borderRadius: 0,
              py: 0.5,
              flexShrink: 0,
              borderBottom: 1,
              borderColor: "warning.main",
              "& .MuiAlert-message": {
                width: "100%",
                textAlign: "center",
              },
            }}
          >
            <strong>Pre-release:</strong> This is an early alpha. The database may be wiped at any
            time without notice.
          </Alert>
          <Sidebar
            mobileOpen={mobileOpen}
            onMobileClose={handleDrawerClose}
            unreadCount={unreadCount}
          />
        </>
      )}
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
        }}
      >
        <Routes>
          <Route path="/" element={showLanding ? <LandingPage /> : <FeedView tab="home" />} />
          <Route path="/explore" element={<FeedView tab="explore" />} />
          <Route path="/observation/:did/:rkey" element={<ObservationDetail />} />
          <Route path="/profile/:did" element={<ProfileView />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/taxon/:kingdom/:name" element={<TaxonDetail />} />
          <Route path="/taxon/:id" element={<TaxonDetail />} />
          <Route path="/lexicons" element={<LexiconView />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Box>
      {!showLanding && <FAB />}
      <LoginModal />
      <UploadModal />
      <DeleteConfirmDialog />
      <ToastContainer />
    </Box>
  );
}

function ThemedApp() {
  const effectiveTheme = useAppSelector((state) => state.ui.effectiveTheme);
  const theme = useMemo(() => getTheme(effectiveTheme), [effectiveTheme]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
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
