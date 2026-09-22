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

/** Small secondary-colored icon styling used by ProfileStat */
export const PROFILE_STAT_ICON_SX: SxProps<Theme> = {
  fontSize: 14,
  color: "text.secondary",
};

/** Icon + label row inside a stat box, shared between ProfileStat and ProfileHeaderSkeleton */
export const PROFILE_STAT_ROW_SX: SxProps<Theme> = {
  alignItems: "center",
  justifyContent: "center",
  mt: 0.5,
};

/** Profile avatar size */
export const PROFILE_AVATAR_SIZE = 80;

/**
 * Identification card header block (icon/species over a tinted panel), shared
 * between ProfileView's real identification cards and their skeleton loader.
 */
export const PROFILE_ID_CARD_HEADER_SX: SxProps<Theme> = {
  py: 3,
  px: 1.5,
  bgcolor: "action.hover",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
};
