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
