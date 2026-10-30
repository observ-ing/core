import { Skeleton } from "@mui/material";

/**
 * Pill-shaped placeholder for a chip while its row is loading. One place for
 * the radius so skeletons stay in step with the real chips.
 */
export function ChipSkeleton({ width, height = 24 }: { width: number; height?: number }) {
  return <Skeleton variant="rectangular" width={width} height={height} sx={{ borderRadius: 4 }} />;
}
