import { useEffect, useMemo } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider, CssBaseline, Box } from "@mui/material";
import { getTheme } from "./theme";
import { store, useAppDispatch, useAppSelector } from "./store";
import { checkAuth } from "./store/authSlice";
import { updateSystemTheme } from "./store/uiSlice";
import { Header } from "./components/layout/Header";
import { FeedView } from "./components/feed/FeedView";
import { MapView } from "./components/map/MapView";
import { OccurrenceDetail } from "./components/occurrence/OccurrenceDetail";
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
      <Header />
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Routes>
          <Route path="/" element={<FeedView />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/occurrence/:uri" element={<OccurrenceDetail />} />
          <Route path="/profile/:did" element={<ProfileView />} />
          <Route path="/taxon/:kingdom/:name" element={<TaxonDetail />} />
          <Route path="/taxon/:id" element={<TaxonDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
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
