import type { SxProps, Theme } from "@mui/material";

/**
 * Responsive observation-card grid styles shared between the feed and profile
 * views. Columns scale with breakpoint: 2 (xs) -> 3 (sm). Pass `mdColumns` to
 * opt into a wider 4-column layout at the `md` breakpoint (used by the feed
 * explore grid); omit it to keep the 3-column layout (used by profile grids).
 */
export function observationGridSx(mdColumns?: 4): SxProps<Theme> {
  return {
    display: "grid",
    gridTemplateColumns: {
      xs: "repeat(2, 1fr)",
      sm: "repeat(3, 1fr)",
      ...(mdColumns ? { md: `repeat(${mdColumns}, 1fr)` } : {}),
    },
    gap: 1.5,
    p: 1.5,
  };
}
