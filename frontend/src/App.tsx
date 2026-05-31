import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider, CssBaseline, Box, Alert } from "@mui/material";
import { getTheme } from "./theme";
import { store, useAppDispatch, useAppSelector } from "./store";
import { checkAuth, loadUserPreferences } from "./store/authSlice";
import { updateSystemTheme } from "./store/uiSlice";
import { useUnreadCount } from "./lib/query/hooks";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { LandingPage } from "./components/landing/LandingPage";
import { FeedView } from "./components/feed/FeedView";
import { ObservationDetail } from "./components/observation/ObservationDetail";
import { ProfileView } from "./components/profile/ProfileView";
import { TaxonExplorer } from "./components/taxon/TaxonExplorer";
import { LoginModal } from "./components/modals/LoginModal";
import { UploadModal } from "./components/modals/UploadModal";
import { DeleteConfirmDialog } from "./components/modals/DeleteConfirmDialog";
import { FAB } from "./components/common/FAB";
import { ToastContainer } from "./components/common/Toast";
import { NotFound } from "./components/common/NotFound";
import { OfflineBanner } from "./components/common/OfflineBanner";
import { UpdatePrompt } from "./components/common/UpdatePrompt";
import { LexiconView } from "./components/lexicon/LexiconView";
import { DocsPage } from "./components/docs/DocsPage";
import { NotificationsPage } from "./components/notifications/NotificationsPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { TransparencyPage } from "./components/transparency/TransparencyPage";
import { QueryProvider } from "./lib/query/QueryProvider";
import "./styles/global.css";

function AppContent() {
  const dispatch = useAppDispatch();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAppSelector((state) => state.auth.user);
  const isAuthLoading = useAppSelector((state) => state.auth.isLoading);

  // Unread notification badge — polls every 30s while signed in (see hook).
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.count ?? 0;

  const handleDrawerOpen = () => setMobileOpen(true);
  const handleDrawerClose = () => setMobileOpen(false);

  useEffect(() => {
    dispatch(checkAuth());
  }, [dispatch]);

  useEffect(() => {
    if (user) dispatch(loadUserPreferences());
  }, [user, dispatch]);

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
    <Box sx={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
      <OfflineBanner />
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
          minHeight: 0,
        }}
      >
        <Routes>
          <Route path="/" element={showLanding ? <LandingPage /> : <FeedView tab="home" />} />
          <Route path="/explore" element={<FeedView tab="explore" />} />
          <Route path="/observation/:did/:rkey" element={<ObservationDetail />} />
          <Route path="/profile/:did" element={<ProfileView />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/taxon/:kingdom/:name" element={<TaxonExplorer />} />
          <Route path="/taxon/:id" element={<TaxonExplorer />} />
          <Route path="/lexicons" element={<LexiconView />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/transparency" element={<TransparencyPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Box>
      {!showLanding && <FAB />}
      <LoginModal />
      <UploadModal />
      <DeleteConfirmDialog />
      <ToastContainer />
      <UpdatePrompt />
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
      <QueryProvider>
        <ThemedApp />
      </QueryProvider>
    </Provider>
  );
}
