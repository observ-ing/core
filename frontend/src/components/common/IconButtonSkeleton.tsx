import { Skeleton, type SkeletonProps } from "@mui/material";

/**
 * Circular placeholder for an icon button (like, overflow menu) while its
 * row is loading. One place for the size so skeletons stay in step.
 */
export function IconButtonSkeleton({ sx }: { sx?: SkeletonProps["sx"] }) {
  return <Skeleton variant="circular" width={30} height={30} sx={sx} />;
}
