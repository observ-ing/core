import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider, CssBaseline, Box, Alert, CircularProgress } from "@mui/material";
import { getTheme } from "./theme";
import { store, useAppDispatch, useAppSelector } from "./store";
import { checkAuth } from "./store/authSlice";
import { updateSystemTheme } from "./store/uiSlice";
import { resumePendingSubmissions } from "./store/pendingSlice";
import { useUnreadCount } from "./lib/query/hooks";
// Eager: the shell (layout, always-mounted modals, global UI) — needed on
// every page, so splitting them buys nothing.
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { LoginModal } from "./components/modals/LoginModal";
import { UploadModal } from "./components/modals/UploadModal";
import { DeleteConfirmDialog } from "./components/modals/DeleteConfirmDialog";
import { FAB } from "./components/common/FAB";
import { ToastContainer } from "./components/common/Toast";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { OfflineBanner } from "./components/common/OfflineBanner";
import { UpdatePrompt } from "./components/common/UpdatePrompt";
import { QueryProvider } from "./lib/query/QueryProvider";
import "./styles/global.css";

// Lazy: route pages load on navigation. Their chunks are precached by the
// service worker, so after the first visit they're instant (and offline).
const LandingPage = lazy(() =>
  import("./components/landing/LandingPage").then((m) => ({ default: m.LandingPage })),
);
const FeedView = lazy(() =>
  import("./components/feed/FeedView").then((m) => ({ default: m.FeedView })),
);
const ObservationDetail = lazy(() =>
  import("./components/observation/ObservationDetail").then((m) => ({
    default: m.ObservationDetail,
  })),
);
const ProfileView = lazy(() =>
  import("./components/profile/ProfileView").then((m) => ({ default: m.ProfileView })),
);
const TaxonExplorer = lazy(() =>
  import("./components/taxon/TaxonExplorer").then((m) => ({ default: m.TaxonExplorer })),
);
const NotificationsPage = lazy(() =>
  import("./components/notifications/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const LexiconView = lazy(() =>
  import("./components/lexicon/LexiconView").then((m) => ({ default: m.LexiconView })),
);
const DocsPage = lazy(() =>
  import("./components/docs/DocsPage").then((m) => ({ default: m.DocsPage })),
);
const SettingsPage = lazy(() =>
  import("./components/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const TransparencyPage = lazy(() =>
  import("./components/transparency/TransparencyPage").then((m) => ({
    default: m.TransparencyPage,
  })),
);
const NotFound = lazy(() =>
  import("./components/common/NotFound").then((m) => ({ default: m.NotFound })),
);
const LiveIdView = lazy(() =>
  import("./components/identification/LiveIdView").then((m) => ({ default: m.LiveIdView })),
);

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
    // Re-arm submissions that were still pending on the last page unload.
    dispatch(resumePendingSubmissions());
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
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense
            fallback={
              <Box
                sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <CircularProgress />
              </Box>
            }
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
              <Route path="/identify" element={<LiveIdView />} />
              <Route path="/transparency" element={<TransparencyPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
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
