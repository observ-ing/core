import { Skeleton } from "@mui/material";

/**
 * Rounded-rectangle placeholder for a section card while its content is
 * loading. One place for the radius so skeletons stay in step with the real
 * section cards.
 */
export function SectionCardSkeleton({ height, mt }: { height: number; mt?: number }) {
  return <Skeleton variant="rectangular" height={height} sx={{ mt, borderRadius: 2 }} />;
}
