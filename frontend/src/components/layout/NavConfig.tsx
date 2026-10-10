import {
  Home,
  Explore,
  Notifications as NotificationsIcon,
  Person,
  PhotoLibrary,
  DarkMode,
  LightMode,
  SettingsBrightness,
} from "@mui/icons-material";
import { Badge } from "@mui/material";
import type { ThemeMode } from "../../store/uiSlice";

export const BATCH_UPLOAD_PATH = "/batch-upload";
export const BATCH_UPLOAD_LABEL = "Batch upload";

export const getNavItems = (
  user: { did: string } | null,
  unreadCount: number,
  { batchUpload = false }: { batchUpload?: boolean } = {},
) => [
  { label: "Home", icon: <Home />, path: "/" },
  { label: "Explore", icon: <Explore />, path: "/explore" },
  ...(user && batchUpload
    ? [{ label: BATCH_UPLOAD_LABEL, icon: <PhotoLibrary />, path: BATCH_UPLOAD_PATH }]
    : []),
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
