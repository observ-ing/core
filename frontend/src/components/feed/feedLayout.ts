import type { SxProps, Theme } from "@mui/material";

/** Card wrapper styles shared between FeedItem and FeedItemSkeleton */
export const FEED_CARD_SX: SxProps<Theme> = {
  mb: 1.5,
  mx: { xs: 0.5, sm: 1 },
  "&:first-of-type": {
    mt: 1.5,
  },
};

/** Max height for feed card images */
export const FEED_IMAGE_MAX_HEIGHT = 280;

/** Observer avatar size in the card header, shared with the skeleton */
export const FEED_AVATAR_SIZE = 40;

/**
 * Card header row: observer (avatar, name, handle, time) beside the overflow
 * menu. Shared with FeedItemSkeleton so the placeholder lines up with the card.
 */
export const FEED_HEADER_SX: SxProps<Theme> = {
  display: "flex",
  gap: 1,
  p: 2,
  alignItems: "flex-start",
};

/**
 * Footer row: species name on the left, like button on the right. Shared with
 * FeedItemSkeleton so the placeholder lines up with the card.
 */
export const FEED_FOOTER_ROW_SX: SxProps<Theme> = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1,
};
