import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Badge,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Divider,
  Avatar,
  Typography,
  IconButton,
  Tooltip,
  Skeleton,
  useTheme,
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
} from "@mui/icons-material";
import { useAppSelector, useAppDispatch } from "../../store";
import { logout } from "../../store/authSlice";
import { openLoginModal, setThemeMode, type ThemeMode } from "../../store/uiSlice";
import { fetchUnreadCount } from "../../services/api";
import { getDisplayName } from "../../lib/utils";
import logoSvg from "../../assets/logo.svg";

export const DRAWER_WIDTH = 280;

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const isAuthLoading = useAppSelector((state) => state.auth.isLoading);
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  const [unreadCount, setUnreadCount] = useState(0);
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

  const navItems = [
    { label: "Home", icon: <Home />, path: "/" },
    { label: "Explore", icon: <Explore />, path: "/explore" },
    ...(user
      ? [
          {
            label: "Notifications",
            icon: (
              <Badge badgeContent={unreadCount} color="error" max={99}>
                <NotificationsIcon />
              </Badge>
            ),
            path: "/notifications",
          },
          {
            label: "Profile",
            icon: <Person />,
            path: `/profile/${encodeURIComponent(user.did)}`,
          },
        ]
      : []),
  ];

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
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

  const getThemeTooltip = () => {
    switch (themeMode) {
      case "light": return "Light mode";
      case "dark": return "Dark mode";
      default: return "System theme";
    }
  };

  const handleLogin = () => {
    dispatch(openLoginModal());
    onMobileClose();
  };

  const handleLogout = () => {
    dispatch(logout());
    onMobileClose();
  };

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Logo */}
      <Box
        component={Link}
        to="/"
        onClick={onMobileClose}
        sx={{
          p: 2.5,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          textDecoration: "none",
        }}
      >
        <img src={logoSvg} alt="" width={28} height={28} />
        <Typography
          variant="h6"
          component="span"
          sx={{
            fontWeight: 800,
            color: "primary.main",
            letterSpacing: "-0.02em",
          }}
        >
          Observ.ing
        </Typography>
      </Box>

      <Divider />

      {/* Navigation */}
      <List sx={{ flex: 1, pt: 1, px: 1 }}>
        {navItems.map((item) => (
          <ListItem key={item.label} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              component={Link}
              to={item.path}
              selected={isActive(item.path)}
              onClick={onMobileClose}
              sx={{
                borderRadius: 2,
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": { bgcolor: "primary.dark" },
                  "& .MuiListItemIcon-root": { color: "primary.contrastText" },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText 
                primary={item.label} 
                primaryTypographyProps={{ fontWeight: isActive(item.path) ? 700 : 500 }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      {/* Bottom section */}
      <Box sx={{ p: 1 }}>
        <Divider sx={{ mb: 1 }} />
        <List dense>
          <ListItem disablePadding>
            <ListItemButton
              component={Link}
              to="/lexicons"
              onClick={onMobileClose}
              sx={{ borderRadius: 2 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Schema fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Lexicons" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton
              component="a"
              href="https://github.com/observ-ing/core"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ borderRadius: 2 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <GitHub fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Source Code" />
            </ListItemButton>
          </ListItem>
        </List>

        <Divider sx={{ my: 1 }} />

        {/* Theme & User */}
        <Box sx={{ p: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, px: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              THEME
            </Typography>
            <Tooltip title={getThemeTooltip()}>
              <IconButton onClick={cycleTheme} size="small" color="inherit">
                {getThemeIcon()}
              </IconButton>
            </Tooltip>
          </Box>

          {isAuthLoading ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1 }}>
              <Skeleton variant="circular" width={40} height={40} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="text" width="60%" />
              </Box>
            </Box>
          ) : user ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1.5,
                borderRadius: 3,
                bgcolor: "action.hover",
              }}
            >
              <Avatar
                {...(user.avatar ? { src: user.avatar } : {})}
                sx={{ width: 40, height: 40, border: 1, borderColor: "divider" }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700} noWrap>
                  {getDisplayName(user, "User")}
                </Typography>
                {user.handle && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    @{user.handle}
                  </Typography>
                )}
              </Box>
              <IconButton size="small" onClick={handleLogout} color="error">
                <Logout fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <ListItemButton
              onClick={handleLogin}
              sx={{
                borderRadius: 2,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
                justifyContent: "center",
                py: 1.5,
              }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: "inherit" }}>
                <Login />
              </ListItemIcon>
              <ListItemText 
                primary="Log in" 
                primaryTypographyProps={{ fontWeight: 700, textAlign: "center" }} 
              />
            </ListItemButton>
          )}
        </Box>
      </Box>
    </Box>
  );

  return (
    <Drawer
      variant="temporary"
      open={mobileOpen}
      onClose={onMobileClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        display: { xs: "block", md: "none" },
        "& .MuiDrawer-paper": {
          boxSizing: "border-box",
          width: DRAWER_WIDTH,
          bgcolor: "background.paper",
          backgroundImage: "none",
        },
      }}
    >
      {drawerContent}
    </Drawer>
  );
}
