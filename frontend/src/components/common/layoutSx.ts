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

/**
 * Left-accent row shell shared by feed-style lists (identification history,
 * comments): a colored border-left with rounded outer corners. Callers add
 * their own `borderColor`, `transition`, and hover behavior on top.
 */
export const accentListItemSx = {
  pl: 2,
  borderLeft: 3,
  borderRadius: "0 4px 4px 0",
  py: 1,
} as const;
