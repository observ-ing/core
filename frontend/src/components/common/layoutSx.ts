import { alpha, type SxProps, type Theme } from "@mui/material/styles";

/** Header bar used by detail-page skeleton loaders (avatar + back-button row). */
export const detailHeaderSx = {
  p: 1.5,
  borderBottom: 1,
  borderColor: "divider",
  display: "flex",
  alignItems: "center",
} as const;

/**
 * Sticky, blurred "glass" header for detail pages: pins to the top of a
 * scrolling pane with a translucent backdrop derived from the page background,
 * so content scrolls under it. Mode-aware via the theme palette.
 */
export const stickyHeaderSx: SxProps<Theme> = {
  position: "sticky",
  top: 0,
  zIndex: 3,
  px: { xs: 2, sm: 4 },
  py: 1.25,
  borderBottom: 1,
  borderColor: "divider",
  display: "flex",
  alignItems: "center",
  backgroundColor: (theme) => alpha(theme.palette.background.default, 0.86),
  backdropFilter: "blur(8px)",
};
