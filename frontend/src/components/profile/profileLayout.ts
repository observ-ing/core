import type { SxProps, Theme } from "@mui/material";

/** Profile header container styles shared between ProfileView and ProfileHeaderSkeleton */
export const PROFILE_HEADER_SX: SxProps<Theme> = {
  p: 3,
  borderBottom: 1,
  borderColor: "divider",
};

/** Profile stat box styles shared between ProfileView and ProfileHeaderSkeleton */
export const PROFILE_STAT_BOX_SX: SxProps<Theme> = {
  textAlign: "center",
  flex: 1,
  bgcolor: "action.hover",
  borderRadius: 2,
  py: 1.5,
  px: 1,
};

/** Profile avatar size */
export const PROFILE_AVATAR_SIZE = 80;
