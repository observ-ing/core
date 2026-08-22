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
 * Frosted "glass" backdrop shared by sticky/translucent surfaces (the app's
 * `TopBar` and detail-page `stickyHeaderSx`): a blurred pane with a
 * bottom divider. Callers add their own `backgroundColor`/`bgcolor` (each
 * surface derives its translucency from a different palette source) and
 * positioning/`zIndex`.
 */
export const glassBlurSx = {
  backdropFilter: "blur(8px)",
  borderBottom: 1,
  borderColor: "divider",
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
  ...glassBlurSx,
  display: "flex",
  alignItems: "center",
  backgroundColor: (theme) => alpha(theme.palette.background.default, 0.86),
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

/**
 * Full-bleed absolute overlay for a `Skeleton` layered over an image's
 * `position: relative` container, shared by `ImageWithSkeleton` and its
 * static loading-state counterpart so the two can't drift apart.
 */
export const imageSkeletonOverlaySx = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
} as const;

/** Primary CTA button in a `FullPageStatus` action row (NotFound, ErrorBoundary). */
export const fullPageStatusPrimaryActionSx = {
  px: 4,
  py: 1,
  fontWeight: 600,
} as const;

/** Secondary CTA button in a `FullPageStatus` action row (NotFound, ErrorBoundary). */
export const fullPageStatusSecondaryActionSx = {
  px: 3,
} as const;
