import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { SxProps, Theme } from "@mui/material/styles";

export interface EmptyStateProps {
  /** Message shown when there is nothing to display. */
  message: ReactNode;
  /** Optional node (e.g. an icon) rendered above the message. */
  icon?: ReactNode | undefined;
  /** Padding applied to the centering Box. Defaults to `4`. */
  p?: number | undefined;
  /** Additional styles merged onto the centering Box. */
  sx?: SxProps<Theme> | undefined;
}

/**
 * Centered empty-state message for list/feed views, matching the
 * `<Box p:4 textAlign:center>` + secondary `<Typography>` look used across the app.
 */
export function EmptyState({ message, icon, p = 4, sx }: EmptyStateProps) {
  return (
    <Box sx={{ p, textAlign: "center", ...sx }}>
      {icon}
      <Typography sx={{ color: "text.secondary" }}>{message}</Typography>
    </Box>
  );
}
