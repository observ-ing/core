import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Box,
  Button,
  IconButton,
  Tooltip,
  Avatar,
  Typography,
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
import { Person, Login, Logout, GitHub, Schema, Menu as MenuIcon } from "@mui/icons-material";
import { getDisplayName } from "../../lib/utils";
import logoSvg from "../../assets/logo.svg";
import { useNavigation } from "../../hooks/useNavigation";
import { getNavItems, getThemeIcon } from "./NavConfig";

interface TopBarProps {
  onMobileMenuClick: () => void;
  unreadCount: number;
}

export function TopBar({ onMobileMenuClick, unreadCount }: TopBarProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const {
    user,
    isAuthLoading,
    themeMode,
    isActive,
    handleLogin,
    handleLogout,
    cycleTheme,
    getThemeTooltip,
  } = useNavigation();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setAnchorEl(null);
  };

  const onLogout = () => {
    handleProfileMenuClose();
    handleLogout();
  };

  const allNavItems = getNavItems(user, unreadCount);
  const mainNavItems = allNavItems.filter(
    (item) => item.label === "Home" || item.label === "Explore",
  );
  const notificationItem = allNavItems.find((item) => item.label === "Notifications");

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
              {mainNavItems.map((item) => (
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

          {notificationItem && (
            <Tooltip title="Notifications">
              <IconButton component={Link} to={notificationItem.path} color="inherit">
                {notificationItem.icon}
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title={getThemeTooltip()}>
            <IconButton onClick={cycleTheme} color="inherit">
              {getThemeIcon(themeMode)}
            </IconButton>
          </Tooltip>

          {isAuthLoading ? (
            <Skeleton variant="circular" width={40} height={40} />
          ) : user ? (
            <>
              <IconButton onClick={handleProfileMenuOpen} sx={{ p: 0.5 }} aria-label="Account menu">
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
                <MenuItem onClick={onLogout}>
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
              onClick={handleLogin}
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
