import type { ReactNode } from "react";
import { Box, Skeleton, Stack } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

export interface UserCardSkeletonProps {
  /** Avatar diameter in pixels (default 40, matches `UserCard`'s default). */
  avatarSize?: number;
  /** Width of the name placeholder line. */
  nameWidth?: number | string;
  /** Height of the name placeholder line (default 20). */
  nameHeight?: number;
  /**
   * Width of a placeholder rendered beside the name on the same baseline row
   * (e.g. a timestamp), matching `UserCard`'s `trailing` slot. Omit to skip.
   */
  trailingWidth?: number | string;
  /** Height of the trailing placeholder (default matches `nameHeight`, capped smaller). */
  trailingHeight?: number;
  /**
   * Width of a placeholder line below the name (e.g. an `@handle`), matching
   * `UserCard`'s `showHandle`/`belowName` slot. Omit to skip.
   */
  subtitleWidth?: number | string;
  /** Height of the subtitle placeholder line (default 16). */
  subtitleHeight?: number;
  /** Content rendered after the text column, e.g. a trailing action button skeleton. */
  endAdornment?: ReactNode;
  /** Horizontal spacing between avatar and text column (default 1.5, matches `UserCard`). */
  spacing?: number;
  /** `sx` for the outer row Stack. */
  sx?: SxProps<Theme>;
}

/**
 * Avatar + name (+ optional trailing/subtitle) placeholder row matching
 * `UserCard`'s layout, shared by loading states across feed, observation, and
 * profile skeletons.
 */
export function UserCardSkeleton({
  avatarSize = 40,
  nameWidth = "30%",
  nameHeight = 20,
  trailingWidth,
  trailingHeight,
  subtitleWidth,
  subtitleHeight = 16,
  endAdornment,
  spacing = 1.5,
  sx,
}: UserCardSkeletonProps) {
  return (
    <Stack direction="row" spacing={spacing} sx={{ alignItems: "center", ...sx }}>
      <Skeleton variant="circular" width={avatarSize} height={avatarSize} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <Skeleton variant="text" width={nameWidth} height={nameHeight} />
          {trailingWidth != null && (
            <Skeleton
              variant="text"
              width={trailingWidth}
              height={trailingHeight ?? subtitleHeight}
            />
          )}
        </Stack>
        {subtitleWidth != null && (
          <Skeleton variant="text" width={subtitleWidth} height={subtitleHeight} />
        )}
      </Box>
      {endAdornment}
    </Stack>
  );
}
