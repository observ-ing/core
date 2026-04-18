import type { SxProps, Theme } from "@mui/material";

/** Card wrapper styles shared between FeedItem and FeedItemSkeleton */
export const FEED_CARD_SX: SxProps<Theme> = {
  mb: 3.25,
  mx: { xs: 0.5, sm: 1 },
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: "background.paper",
  boxShadow: "none",
  transition: "border-color 0.15s",
  "&:hover": {
    borderColor: "var(--ov-border-strong)",
  },
  "&:first-of-type": {
    mt: 1.5,
  },
};

/** Max height for feed card images */
export const FEED_IMAGE_MAX_HEIGHT = 280;
