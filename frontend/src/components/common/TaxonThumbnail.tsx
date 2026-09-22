import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

export interface TaxonThumbnailProps {
  /** Photo URL. */
  src?: string | undefined;
  /** Square size in px. Defaults to 24. */
  size?: number | undefined;
  /** Theme shape-scale border radius multiplier. Defaults to 1. */
  borderRadius?: number | string | undefined;
  /** Palette token to fill the box with when there is no `src`. Omit to render nothing in that case. */
  emptyBgcolor?: string | undefined;
  /** Extra sx merged onto the box (e.g. flexShrink, display overrides). */
  sx?: SxProps<Theme> | undefined;
}

/**
 * A fixed-size taxon/species photo thumbnail, cover-fit with lazy loading.
 * Used for autocomplete rows, ID suggestion cards, filter panels, and tables.
 */
export function TaxonThumbnail({
  src,
  size = 24,
  borderRadius = 1,
  emptyBgcolor,
  sx,
}: TaxonThumbnailProps) {
  const baseSx = { width: size, height: size, minWidth: size, borderRadius, ...sx };

  if (!src) {
    if (!emptyBgcolor) return null;
    return <Box sx={{ ...baseSx, bgcolor: emptyBgcolor }} />;
  }

  return (
    <Box component="img" src={src} alt="" loading="lazy" sx={{ ...baseSx, objectFit: "cover" }} />
  );
}
