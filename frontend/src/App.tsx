import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider, CssBaseline, Box, Alert, CircularProgress } from "@mui/material";
import { getTheme } from "./theme";
import { store, useAppDispatch, useAppSelector } from "./store";
import { checkAuth } from "./store/authSlice";
import { updateSystemTheme } from "./store/uiSlice";
import { Sidebar, DRAWER_WIDTH } from "./components/layout/Sidebar";
import { LoginModal } from "./components/modals/LoginModal";
import { FAB } from "./components/common/FAB";
import { ToastContainer } from "./components/common/Toast";
import { NotFound } from "./components/common/NotFound";
import "./styles/global.css";

// Lazy-loaded route components
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
const TaxonDetail = lazy(() =>
  import("./components/taxon/TaxonDetail").then((m) => ({ default: m.TaxonDetail })),
);
const UploadModal = lazy(() =>
  import("./components/modals/UploadModal").then((m) => ({ default: m.UploadModal })),
);
const DeleteConfirmDialog = lazy(() =>
  import("./components/modals/DeleteConfirmDialog").then((m) => ({
    default: m.DeleteConfirmDialog,
  })),
);
const LexiconView = lazy(() =>
  import("./components/lexicon/LexiconView").then((m) => ({ default: m.LexiconView })),
);
const NotificationsPage = lazy(() =>
  import("./components/notifications/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);

function PageLoading() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
      <CircularProgress />
    </Box>
  );
}

function AppContent() {
  const dispatch = useAppDispatch();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAppSelector((state) => state.auth.user);
  const isAuthLoading = useAppSelector((state) => state.auth.isLoading);

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

  const location = useLocation();
  const showLanding = !user && !isAuthLoading && location.pathname === "/";

  return (
    <>
      {!showLanding && (
        <Alert
          severity="warning"
          sx={{
            borderRadius: 0,
            py: 1,
            flexShrink: 0,
            ml: { md: `${DRAWER_WIDTH}px` },
            "& .MuiAlert-message": {
              width: "100%",
              textAlign: "center",
            },
          }}
        >
          <strong>Pre-release:</strong> This is an early alpha. The database may be wiped at any
          time without notice.
        </Alert>
      )}
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {!showLanding && <Sidebar mobileOpen={mobileOpen} onMobileClose={handleDrawerToggle} />}
        <Box
          component="main"
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            width: showLanding ? "100%" : { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          }}
        >
          <Suspense fallback={<PageLoading />}>
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
          </Suspense>
        </Box>
      </Box>
      {!showLanding && <FAB />}
      <LoginModal />
      <Suspense>
        <UploadModal />
        <DeleteConfirmDialog />
      </Suspense>
      <ToastContainer />
    </>
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
