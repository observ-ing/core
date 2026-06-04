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
 * Horizontally-centered spinner used as the "loading more" indicator at the
 * bottom of paginated list/feed views.
 */
export function CenteredSpinner({ size = 24, color, p = 4, sx }: CenteredSpinnerProps) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", p, ...sx }}>
      <CircularProgress size={size} {...(color ? { color } : {})} />
    </Box>
  );
}
