import { Link, useLocation } from "react-router-dom";
import {
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
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  Home,
  Explore,
  Person,
  DarkMode,
  LightMode,
  SettingsBrightness,
  Login,
  Logout,
  GitHub,
  Schema,
  Menu as MenuIcon,
} from "@mui/icons-material";
import { useAppSelector, useAppDispatch } from "../../store";
import { logout } from "../../store/authSlice";
import { openLoginModal, setThemeMode, type ThemeMode } from "../../store/uiSlice";
import logoSvg from "../../assets/logo.svg";

export const DRAWER_WIDTH = 240;

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const location = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const themeMode = useAppSelector((state) => state.ui.themeMode);

  const navItems = [
    { label: "Home", icon: <Home />, path: "/" },
    { label: "Explore", icon: <Explore />, path: "/explore" },
    ...(user
      ? [
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
        return "Light mode";
      case "dark":
        return "Dark mode";
      default:
        return "System theme";
    }
  };

  const handleLogin = () => {
    dispatch(openLoginModal());
    if (isMobile) onMobileClose();
  };

  const handleLogout = () => {
    dispatch(logout());
    if (isMobile) onMobileClose();
  };

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Logo */}
      <Box
        component={Link}
        to="/"
        onClick={isMobile ? onMobileClose : undefined}
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          gap: 1,
          textDecoration: "none",
          "&:hover": { opacity: 0.8 },
        }}
      >
        <img src={logoSvg} alt="" width={28} height={28} />
        <Typography
          variant="h6"
          sx={{
            fontWeight: 700,
            color: "primary.main",
          }}
        >
          Observ.ing
        </Typography>
      </Box>

      <Divider />

      {/* Navigation */}
      <List sx={{ flex: 1, pt: 1 }}>
        {navItems.map((item) => (
          <ListItem key={item.label} disablePadding>
            <ListItemButton
              component={Link}
              to={item.path}
              selected={isActive(item.path)}
              onClick={isMobile ? onMobileClose : undefined}
              sx={{
                mx: 1,
                borderRadius: 2,
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": {
                    bgcolor: "primary.dark",
                  },
                  "& .MuiListItemIcon-root": {
                    color: "primary.contrastText",
                  },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      {/* Bottom section */}
      <Box>
        <Divider />

        {/* Links */}
        <List dense>
          <ListItem disablePadding>
            <ListItemButton
              component="a"
              href="https://github.com/observ-ing/core"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ mx: 1, borderRadius: 2 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <GitHub fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Source Code" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton
              component={Link}
              to="/lexicons"
              onClick={isMobile ? onMobileClose : undefined}
              sx={{ mx: 1, borderRadius: 2 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Schema fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Lexicons" />
            </ListItemButton>
          </ListItem>
        </List>

        <Divider />

        {/* Theme & User */}
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {getThemeTooltip()}
            </Typography>
            <Tooltip title="Toggle theme">
              <IconButton onClick={cycleTheme} size="small">
                {getThemeIcon()}
              </IconButton>
            </Tooltip>
          </Box>

          {user ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1,
                borderRadius: 2,
                bgcolor: "action.hover",
              }}
            >
              <Avatar
                src={user.avatar}
                sx={{ width: 36, height: 36 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {user.displayName || user.handle || "User"}
                </Typography>
                {user.handle && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    @{user.handle}
                  </Typography>
                )}
              </Box>
              <Tooltip title="Log out">
                <IconButton size="small" onClick={handleLogout}>
                  <Logout fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ) : (
            <ListItemButton
              onClick={handleLogin}
              sx={{
                borderRadius: 2,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": {
                  bgcolor: "primary.dark",
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: "inherit" }}>
                <Login />
              </ListItemIcon>
              <ListItemText primary="Log in" />
            </ListItemButton>
          )}
        </Box>
      </Box>
    </Box>
  );

  return (
    <>
      {/* Mobile menu button */}
      <IconButton
        color="inherit"
        aria-label="open drawer"
        onClick={onMobileClose}
        sx={{
          display: { md: "none" },
          position: "fixed",
          top: 8,
          left: 8,
          zIndex: theme.zIndex.drawer + 1,
          bgcolor: "background.paper",
          boxShadow: 1,
          "&:hover": { bgcolor: "background.paper" },
        }}
      >
        <MenuIcon />
      </IconButton>

      <Box
        component="nav"
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
      >
        {/* Mobile drawer */}
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
            },
          }}
        >
          {drawerContent}
        </Drawer>

        {/* Desktop drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
              bgcolor: "background.paper",
              borderRight: 1,
              borderColor: "divider",
            },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>
    </>
  );
}
