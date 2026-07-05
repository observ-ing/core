import { Chip, CircularProgress, useTheme } from "@mui/material";

// Overlay chip marking a feed row as a not-yet-ingested optimistic submission.
// Pair it with a dimmed, interaction-disabled card; it clears once the ingester
// catches up and the pending slice drops the row's uri (see pendingSlice +
// occurrenceCache `reconcileOccurrence`).
export function PendingBadge() {
  const theme = useTheme();
  return (
    <Chip
      size="small"
      icon={<CircularProgress size={12} thickness={6} sx={{ color: "inherit !important" }} />}
      label="Processing…"
      sx={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 1,
        bgcolor: theme.palette.overlay["badge"],
        color: "common.white",
      }}
    />
  );
}
