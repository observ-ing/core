import { useEffect, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";

interface SpeciesIdProgressProps {
  /**
   * Epoch ms when a cold species-id service should be ready (from
   * `useSpeciesIdReadyAt`), or null when it's warm or unknown.
   */
  readyAt: number | null;
  /** Text/spinner color; the live camera overlay needs white. */
  color?: string;
}

/**
 * Pending-ID indicator. While the species-id service is booting from zero it
 * counts down the estimated wait; otherwise it's a plain "Identifying…".
 */
export function SpeciesIdProgress({ readyAt, color = "text.secondary" }: SpeciesIdProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  const counting = readyAt !== null && readyAt > now;

  // Tick once a second until the estimated ready time passes.
  useEffect(() => {
    if (readyAt === null) return undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(() => {
      tick();
      if (Date.now() >= readyAt) clearInterval(id);
    }, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [readyAt]);

  const secondsLeft = readyAt === null ? 0 : Math.ceil((readyAt - now) / 1000);

  return (
    <Box
      role="status"
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, mb: 1 }}
    >
      <CircularProgress size={16} sx={{ color }} />
      <Typography variant="caption" sx={{ color }}>
        {counting ? `Starting up species ID… about ${secondsLeft}s` : "Identifying species..."}
      </Typography>
    </Box>
  );
}
