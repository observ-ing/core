import { Chip, CircularProgress, useTheme } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

// Overlay chip marking a row as a not-yet-ingested optimistic submission.
// Pair it with pendingCardSx() on the card's CardActionArea; it clears once
// the ingester catches up and the pending slice drops the row's uri (see
// pendingSlice + occurrenceCache `reconcileOccurrence`).
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

// Dims and freezes interaction on a card's CardActionArea while it's pending:
// navigation would 404 and any menu actions would act on a record that
// doesn't exist yet, so all interaction is disabled until reconciliation.
export const pendingCardSx = (pending: boolean): SxProps<Theme> | undefined =>
  pending ? { opacity: 0.7, pointerEvents: "none" } : undefined;
