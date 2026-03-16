import { Box, Skeleton, Stack } from "@mui/material";
import { PROFILE_HEADER_SX, PROFILE_STAT_BOX_SX, PROFILE_AVATAR_SIZE } from "./profileLayout";

/**
 * Skeleton loader matching profile header layout
 */
export function ProfileHeaderSkeleton() {
  return (
    <Box sx={PROFILE_HEADER_SX}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Skeleton variant="circular" width={PROFILE_AVATAR_SIZE} height={PROFILE_AVATAR_SIZE} />
        <Box>
          <Skeleton variant="text" width={180} height={32} />
          <Skeleton variant="text" width={120} height={20} />
        </Box>
      </Stack>
      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        {[1, 2, 3].map((i) => (
          <Box key={i} sx={PROFILE_STAT_BOX_SX}>
            <Skeleton variant="text" width="50%" height={28} sx={{ mx: "auto" }} />
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="center"
              spacing={0.5}
              sx={{ mt: 0.5 }}
            >
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
