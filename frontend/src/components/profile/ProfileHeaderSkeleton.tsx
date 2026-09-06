import { Box, Skeleton, Stack } from "@mui/material";
import { UserCardSkeleton } from "../common/UserCardSkeleton";
import {
  PROFILE_HEADER_SX,
  PROFILE_STAT_BOX_SX,
  PROFILE_STAT_ROW_SX,
  PROFILE_AVATAR_SIZE,
} from "./profileLayout";

/**
 * Skeleton loader matching profile header layout
 */
export function ProfileHeaderSkeleton() {
  return (
    <Box sx={PROFILE_HEADER_SX}>
      <UserCardSkeleton
        avatarSize={PROFILE_AVATAR_SIZE}
        spacing={2}
        nameWidth={180}
        nameHeight={32}
        subtitleWidth={120}
        subtitleHeight={20}
      />
      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        {[1, 2, 3].map((i) => (
          <Box key={i} sx={PROFILE_STAT_BOX_SX}>
            <Skeleton variant="text" width="50%" height={28} sx={{ mx: "auto" }} />
            <Stack direction="row" spacing={0.5} sx={PROFILE_STAT_ROW_SX}>
              <Skeleton variant="circular" width={14} height={14} />
              <Skeleton variant="text" width="50%" height={16} />
            </Stack>
          </Box>
        ))}
      </Stack>
      <Skeleton variant="rectangular" width={160} height={32} sx={{ borderRadius: 1, mt: 2 }} />
    </Box>
  );
}
