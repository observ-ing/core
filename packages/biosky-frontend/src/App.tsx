import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider, CssBaseline, Box } from "@mui/material";
import theme from "./theme";
import { store, useAppDispatch } from "./store";
import { checkAuth } from "./store/authSlice";
import { Header } from "./components/layout/Header";
import { BottomNav } from "./components/layout/BottomNav";
import { FeedView } from "./components/feed/FeedView";
import { MapView } from "./components/map/MapView";
import { OccurrenceDetail } from "./components/occurrence/OccurrenceDetail";
import { ProfileView } from "./components/profile/ProfileView";
import { TaxonDetail } from "./components/taxon/TaxonDetail";
import { LoginModal } from "./components/modals/LoginModal";
import { UploadModal } from "./components/modals/UploadModal";
import { FAB } from "./components/common/FAB";
import { ToastContainer } from "./components/common/Toast";
import { NotFound } from "./components/common/NotFound";
import "./styles/global.css";

function AppContent() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(checkAuth());
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
          paddingBottom: "60px",
        }}
      >
        <Routes>
          <Route path="/" element={<FeedView />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/occurrence/:uri" element={<OccurrenceDetail />} />
          <Route path="/profile/:did" element={<ProfileView />} />
          <Route path="/taxon/:id" element={<TaxonDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Box>
      <FAB />
      <BottomNav />
      <LoginModal />
      <UploadModal />
      <ToastContainer />
    </BrowserRouter>
  );
}

export function App() {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AppContent />
      </ThemeProvider>
    </Provider>
  );
}
