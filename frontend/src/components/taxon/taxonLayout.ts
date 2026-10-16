import type { SxProps, Theme } from "@mui/material";

/**
 * Centered reading column below the sticky header, shared between
 * TaxonDetailPanel and TaxonDetailSkeleton
 */
export const TAXON_DETAIL_COLUMN_SX: SxProps<Theme> = {
  maxWidth: 960,
  mx: "auto",
  px: { xs: 2, sm: 4 },
  pt: 3.5,
  pb: 7.5,
};

/** Side length of the square hero image card */
export const TAXON_HERO_IMAGE_SIZE = 248;

/** Corner radius (theme spacing units) of the hero image card and its skeleton */
export const TAXON_HERO_IMAGE_RADIUS = 1.75;

/** Divider + spacing above the "Recent Observations" heading */
export const TAXON_OBSERVATIONS_HEADER_SX: SxProps<Theme> = {
  mt: 4.25,
  pt: 3,
  borderTop: 1,
  borderColor: "divider",
};
