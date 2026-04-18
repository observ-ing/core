import { Link } from "react-router-dom";
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Divider,
  Typography,
} from "@mui/material";
import { Login, Logout, GitHub } from "@mui/icons-material";
import logoSvg from "../../assets/logo.svg";
import { useNavigation } from "../../hooks/useNavigation";
import { getNavItems } from "./NavConfig";

export const DRAWER_WIDTH = 240;

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  unreadCount: number;
}

export function Sidebar({ mobileOpen, onMobileClose, unreadCount }: SidebarProps) {
  const { user, isActive, handleLogin, handleLogout } = useNavigation();

  const onLogin = () => {
    handleLogin();
    onMobileClose();
  };

  const onLogout = () => {
    handleLogout();
    onMobileClose();
  };

  const navItems = getNavItems(user, unreadCount);

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
                slotProps={{ primary: { sx: { fontWeight: isActive(item.path) ? 700 : 500 } } }}
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

        {user ? (
          <ListItemButton onClick={onLogout} sx={{ borderRadius: 2 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Logout fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Log out" />
          </ListItemButton>
        ) : (
          <ListItemButton
            onClick={onLogin}
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
              slotProps={{ primary: { sx: { fontWeight: 700, textAlign: "center" } } }}
            />
          </ListItemButton>
        )}
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
