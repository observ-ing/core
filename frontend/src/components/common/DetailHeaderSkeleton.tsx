import { Box, Skeleton } from "@mui/material";
import { detailHeaderSx } from "./layoutSx";

export interface DetailHeaderSkeletonProps {
  /** Width of the placeholder title text, in px. */
  titleWidth: number;
}

/**
 * Avatar + title placeholder row shared by detail-page skeleton loaders
 * (taxon detail, observation detail), matching the real page's `detailHeaderSx` bar.
 */
export function DetailHeaderSkeleton({ titleWidth }: DetailHeaderSkeletonProps) {
  return (
    <Box sx={detailHeaderSx}>
      <Skeleton variant="circular" width={40} height={40} sx={{ mr: 1 }} />
      <Skeleton variant="text" width={titleWidth} height={24} />
    </Box>
  );
}
