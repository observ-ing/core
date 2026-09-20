import { Box } from "@mui/material";
import PlaceIcon from "@mui/icons-material/Place";

export interface InRangeIndicatorProps {
  /** Icon size in px. */
  size?: number;
  /** MUI palette path for the icon color. */
  color?: string;
}

/**
 * Marks a species suggestion as within the observer's geographic range.
 * Renders the pin icon inside a labelled wrapper so assistive tech
 * announces it — MUI's SvgIcon defaults to aria-hidden and ignores an
 * aria-label passed directly to the icon.
 */
export function InRangeIndicator({ size = 14, color = "success.main" }: InRangeIndicatorProps) {
  return (
    <Box
      component="span"
      role="img"
      sx={{ display: "inline-flex", alignItems: "center", color }}
      title="Found in your area"
      aria-label="Found in your area"
    >
      <PlaceIcon aria-hidden sx={{ fontSize: size }} />
    </Box>
  );
}
