import type { ReactNode } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

export interface SectionProps {
  children: ReactNode;
  /** Extra `sx` merged onto the card wrapper. */
  sx?: SxProps<Theme>;
}

/**
 * Bordered card wrapper shared by the observation detail sections (Details,
 * Data quality, Identification history, Discussion) so they read as peers
 * instead of each defining its own Paper styling.
 */
export function Section({ children, sx }: SectionProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        bgcolor: "background.paper",
        borderRadius: 2,
        border: 1,
        borderColor: "divider",
        ...sx,
      }}
    >
      {children}
    </Paper>
  );
}

export interface SectionHeaderProps {
  /** Leading icon (caller sets its own color, typically `primary.main`). */
  icon: ReactNode;
  title: ReactNode;
  /** Trailing content (count chip, add button, expand toggle), right-aligned. */
  trailing?: ReactNode;
  /** When set the whole header row becomes clickable (used by collapsibles). */
  onClick?: () => void;
  /** Extra `sx` merged onto the header row (e.g. bottom spacing). */
  sx?: SxProps<Theme>;
}

/**
 * Icon + title (+ optional right-aligned trailing slot) row used as the header
 * of each {@link Section}.
 */
export function SectionHeader({ icon, title, trailing, onClick, sx }: SectionHeaderProps) {
  return (
    <Stack
      direction="row"
      spacing={1}
      {...(onClick ? { onClick } : {})}
      sx={{
        alignItems: "center",
        ...(onClick ? { cursor: "pointer", userSelect: "none" } : {}),
        ...sx,
      }}
    >
      {icon}
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {trailing != null && (
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>{trailing}</Box>
      )}
    </Stack>
  );
}
