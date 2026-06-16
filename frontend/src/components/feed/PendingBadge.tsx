import { Chip, CircularProgress } from "@mui/material";

// Overlay chip marking a feed row as a not-yet-ingested optimistic submission.
// Pair it with a dimmed, interaction-disabled card; it clears once the ingester
// catches up and the pending slice drops the row's uri (see pendingSlice +
// occurrenceCache `reconcileOccurrence`).
export function PendingBadge() {
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
        bgcolor: "rgba(0, 0, 0, 0.65)",
        color: "white",
      }}
    />
  );
}
