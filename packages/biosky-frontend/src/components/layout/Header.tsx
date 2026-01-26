import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Stack,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  Divider,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import {
  DarkMode,
  LightMode,
  SettingsBrightness,
  Info,
  ViewList,
  Map,
} from "@mui/icons-material";
import { useAppDispatch, useAppSelector } from "../../store";
import { logout } from "../../store/authSlice";
import { openLoginModal, setThemeMode, type ThemeMode } from "../../store/uiSlice";

export function Header() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  const [infoAnchor, setInfoAnchor] = useState<null | HTMLElement>(null);

  const currentView = location.pathname === "/map" ? "map" : "feed";

  const handleViewChange = (_: React.MouseEvent<HTMLElement>, newView: string | null) => {
    if (newView) {
      navigate(newView === "map" ? "/map" : "/");
    }
  };

  const handleLogout = () => {
    dispatch(logout());
  };

  const handleInfoOpen = (event: React.MouseEvent<HTMLElement>) => {
    setInfoAnchor(event.currentTarget);
  };

  const handleInfoClose = () => {
    setInfoAnchor(null);
  };

  const handleLogin = () => {
    dispatch(openLoginModal());
  };

  const cycleTheme = () => {
    const nextMode: ThemeMode =
      themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
    dispatch(setThemeMode(nextMode));
  };

  const getThemeIcon = () => {
    switch (themeMode) {
      case "light":
        return <LightMode />;
      case "dark":
        return <DarkMode />;
      default:
        return <SettingsBrightness />;
    }
  };

  const getThemeTooltip = () => {
    switch (themeMode) {
      case "light":
        return "Light mode (click for dark)";
      case "dark":
        return "Dark mode (click for system)";
      default:
        return "System theme (click for light)";
    }
  };

  return (
    <AppBar position="static" elevation={0}>
      <Toolbar sx={{ justifyContent: "space-between" }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, color: "primary.main" }}
          >
            BioSky
          </Typography>
          <ToggleButtonGroup
            value={currentView}
            exclusive
            onChange={handleViewChange}
            size="small"
            sx={{
              "& .MuiToggleButton-root": {
                px: 1.5,
                py: 0.5,
                border: 1,
                borderColor: "divider",
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": {
                    bgcolor: "primary.dark",
                  },
                },
              },
            }}
          >
            <ToggleButton value="feed" aria-label="Feed view">
              <ViewList sx={{ fontSize: 18, mr: 0.5 }} />
              Feed
            </ToggleButton>
            <ToggleButton value="map" aria-label="Map view">
              <Map sx={{ fontSize: 18, mr: 0.5 }} />
              Map
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title="About">
            <IconButton
              onClick={handleInfoOpen}
              size="small"
              sx={{ color: "text.secondary" }}
            >
              <Info />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={infoAnchor}
            open={Boolean(infoAnchor)}
            onClose={handleInfoClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <MenuItem
              component="a"
              href="https://github.com/frewsxcv/biosky"
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleInfoClose}
            >
              Source Code
            </MenuItem>
            <MenuItem
              component="a"
              href="/api/docs"
              onClick={handleInfoClose}
            >
              API Docs
            </MenuItem>
            <Divider />
            <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem" }}>
              © {new Date().getFullYear()} BioSky
            </MenuItem>
          </Menu>
          <Tooltip title={getThemeTooltip()}>
            <IconButton
              onClick={cycleTheme}
              size="small"
              sx={{ color: "text.secondary" }}
            >
              {getThemeIcon()}
            </IconButton>
          </Tooltip>
          {user ? (
            <>
              <Typography
                variant="body2"
                sx={{ color: "primary.main", fontWeight: 500 }}
              >
                {user.handle ? `@${user.handle}` : user.did}
              </Typography>
              <Button
                variant="outlined"
                color="primary"
                size="small"
                onClick={handleLogout}
              >
                Log out
              </Button>
            </>
          ) : (
            <Button
              variant="outlined"
              color="primary"
              size="small"
              onClick={handleLogin}
            >
              Log in
            </Button>
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
