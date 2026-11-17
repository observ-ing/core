import { Box, CircularProgress } from "@mui/material";
import type { CircularProgressProps } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

export interface CenteredSpinnerProps {
  /** CircularProgress size in px. Defaults to 24. */
  size?: number | undefined;
  /** CircularProgress color. */
  color?: CircularProgressProps["color"] | undefined;
  /** Padding applied to the centering Box. Defaults to `4`. */
  p?: number | undefined;
  /** Additional styles merged onto the centering Box. */
  sx?: SxProps<Theme> | undefined;
}

/**
 * Spinner centered on both axes of its box. With no size constraint it is the
 * "loading more" indicator at the bottom of paginated list/feed views; give it
 * a `height` or `flex: 1` via `sx` to fill a Suspense fallback slot (maps,
 * routes) with the spinner in the middle.
 */
export function CenteredSpinner({ size = 24, color, p = 4, sx }: CenteredSpinnerProps) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", p, ...sx }}>
      <CircularProgress size={size} {...(color ? { color } : {})} />
    </Box>
  );
}
