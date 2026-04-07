import {
  Home,
  Explore,
  Notifications as NotificationsIcon,
  Person,
  DarkMode,
  LightMode,
  SettingsBrightness,
} from "@mui/icons-material";
import { Badge } from "@mui/material";
import type { ThemeMode } from "../../store/uiSlice";

export const getNavItems = (user: { did: string } | null, unreadCount: number) => [
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

export const getThemeIcon = (themeMode: ThemeMode) => {
  switch (themeMode) {
    case "light":
      return <LightMode />;
    case "dark":
      return <DarkMode />;
    default:
      return <SettingsBrightness />;
  }
};
