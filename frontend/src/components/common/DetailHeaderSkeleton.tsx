import { Box, Skeleton } from "@mui/material";
import { detailHeaderSx, stickyHeaderSx } from "./layoutSx";

export interface DetailHeaderSkeletonProps {
  /** Width of the placeholder title text, in px. */
  titleWidth: number;
  /**
   * Match `stickyHeaderSx` (sticky, blurred) instead of the default
   * `detailHeaderSx` bar — set this when the real page's header is sticky,
   * e.g. the taxon detail panel, so the loading state doesn't visually jump.
   */
  sticky?: boolean;
}

/**
 * Avatar + title placeholder row shared by detail-page skeleton loaders
 * (taxon detail, observation detail), matching the real page's header bar
 * (`detailHeaderSx` by default, or `stickyHeaderSx` when `sticky` is set).
 */
export function DetailHeaderSkeleton({ titleWidth, sticky }: DetailHeaderSkeletonProps) {
  return (
    <Box sx={sticky ? stickyHeaderSx : detailHeaderSx}>
      <Skeleton variant="circular" width={40} height={40} sx={{ mr: 1 }} />
      <Skeleton variant="text" width={titleWidth} height={24} />
    </Box>
  );
}
