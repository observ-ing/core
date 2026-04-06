import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Box,
  Button,
  IconButton,
  Tooltip,
  Avatar,
  Typography,
  Badge,
  Skeleton,
  useTheme,
  useMediaQuery,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  alpha,
} from "@mui/material";
import {
  Home,
  Explore,
  Notifications as NotificationsIcon,
  Person,
  DarkMode,
  LightMode,
  SettingsBrightness,
  Login,
  Logout,
  GitHub,
  Schema,
  Menu as MenuIcon,
  MoreVert,
} from "@mui/icons-material";
import { useAppSelector, useAppDispatch } from "../../store";
import { logout } from "../../store/authSlice";
import { openLoginModal, setThemeMode, type ThemeMode } from "../../store/uiSlice";
import { fetchUnreadCount } from "../../services/api";
import { getDisplayName } from "../../lib/utils";
import logoSvg from "../../assets/logo.svg";

interface TopBarProps {
  onMobileMenuClick: () => void;
}

export function TopBar({ onMobileMenuClick }: TopBarProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const location = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const isAuthLoading = useAppSelector((state) => state.auth.isLoading);
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  
  const [unreadCount, setUnreadCount] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll unread count when logged in
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

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleProfileMenuClose();
    dispatch(logout());
  };

  const cycleTheme = () => {
    const nextMode: ThemeMode =
      themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
    dispatch(setThemeMode(nextMode));
  };

  const getThemeIcon = () => {
    switch (themeMode) {
      case "light": return <LightMode />;
      case "dark": return <DarkMode />;
      default: return <SettingsBrightness />;
    }
  };

  const navItems = [
    { label: "Home", icon: <Home />, path: "/" },
    { label: "Explore", icon: <Explore />, path: "/explore" },
  ];

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.8),
        backdropFilter: "blur(8px)",
        color: "text.primary",
        borderBottom: 1,
        borderColor: "divider",
        zIndex: theme.zIndex.drawer + 1,
      }}
    >
      <Toolbar sx={{ justifyContent: "space-between", minHeight: { xs: 64, md: 72 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1, md: 3 } }}>
          {isMobile && (
            <IconButton
              edge="start"
              color="inherit"
              aria-label="menu"
              onClick={onMobileMenuClick}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* Logo */}
          <Box
            component={Link}
            to="/"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              textDecoration: "none",
              mr: 2,
              "&:hover": { opacity: 0.8 },
            }}
          >
            <img src={logoSvg} alt="" width={32} height={32} />
            <Typography
              variant="h6"
              component="span"
              sx={{
                fontWeight: 800,
                color: "primary.main",
                display: { xs: "none", sm: "block" },
                letterSpacing: "-0.02em",
              }}
            >
              Observ.ing
            </Typography>
          </Box>

          {/* Desktop Nav */}
          {!isMobile && (
            <Box sx={{ display: "flex", gap: 1 }}>
              {navItems.map((item) => (
                <Button
                  key={item.label}
                  component={Link}
                  to={item.path}
                  startIcon={item.icon}
                  sx={{
                    px: 2,
                    py: 1,
                    borderRadius: 2,
                    color: isActive(item.path) ? "primary.main" : "text.secondary",
                    fontWeight: isActive(item.path) ? 700 : 500,
                    "&:hover": {
                      bgcolor: "action.hover",
                      color: "primary.main",
                    },
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
          )}
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0.5, md: 1.5 } }}>
          {!isMobile && (
            <>
              <Tooltip title="Lexicons">
                <IconButton component={Link} to="/lexicons" color="inherit">
                  <Schema />
                </IconButton>
              </Tooltip>
              <Tooltip title="Source Code">
                <IconButton
                  component="a"
                  href="https://github.com/observ-ing/core"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="inherit"
                >
                  <GitHub />
                </IconButton>
              </Tooltip>
            </>
          )}

          {user && (
            <Tooltip title="Notifications">
              <IconButton component={Link} to="/notifications" color="inherit">
                <Badge badgeContent={unreadCount} color="error">
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title="Toggle theme">
            <IconButton onClick={cycleTheme} color="inherit">
              {getThemeIcon()}
            </IconButton>
          </Tooltip>

          {isAuthLoading ? (
            <Skeleton variant="circular" width={40} height={40} />
          ) : user ? (
            <>
              <IconButton onClick={handleProfileMenuOpen} sx={{ p: 0.5 }}>
                <Avatar
                  {...(user.avatar ? { src: user.avatar } : {})}
                  sx={{ width: 40, height: 40, border: 2, borderColor: "divider" }}
                />
              </IconButton>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleProfileMenuClose}
                onClick={handleProfileMenuClose}
                PaperProps={{
                  elevation: 4,
                  sx: {
                    mt: 1.5,
                    minWidth: 200,
                    borderRadius: 2,
                    "& .MuiMenuItem-root": {
                      px: 2,
                      py: 1,
                      borderRadius: 1,
                      mx: 1,
                      my: 0.5,
                    },
                  },
                }}
                transformOrigin={{ horizontal: "right", vertical: "top" }}
                anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
              >
                <Box sx={{ px: 2, py: 1.5 }}>
                  <Typography variant="subtitle1" fontWeight={700} noWrap>
                    {getDisplayName(user, "User")}
                  </Typography>
                  {user.handle && (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      @{user.handle}
                    </Typography>
                  )}
                </Box>
                <Divider sx={{ my: 1 }} />
                <MenuItem component={Link} to={`/profile/${encodeURIComponent(user.did)}`}>
                  <ListItemIcon>
                    <Person fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Profile" />
                </MenuItem>
                <MenuItem onClick={handleLogout}>
                  <ListItemIcon>
                    <Logout fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Log out" />
                </MenuItem>
              </Menu>
            </>
          ) : (
            <Button
              variant="contained"
              onClick={() => dispatch(openLoginModal())}
              startIcon={<Login />}
              sx={{
                borderRadius: 2,
                px: 3,
                fontWeight: 700,
                boxShadow: "none",
                "&:hover": { boxShadow: "none" },
              }}
            >
              Log in
            </Button>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
