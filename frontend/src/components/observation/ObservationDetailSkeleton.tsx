import { Box, Divider, Skeleton, Stack, Typography } from "@mui/material";
import { DetailHeaderSkeleton } from "../common/DetailHeaderSkeleton";
import { IconButtonSkeleton } from "../common/IconButtonSkeleton";
import { SectionCardSkeleton } from "../common/SectionCardSkeleton";
import { UserCardSkeleton } from "../common/UserCardSkeleton";
import {
  OBSERVATION_PHOTO_LICENSE_SX,
  OBSERVATION_PHOTO_MAX_HEIGHT,
  OBSERVATION_PHOTO_RADIUS,
  OBSERVATION_PHOTO_STAGE_SX,
} from "./observationLayout";

// Placeholder heights for the section cards below the image, sized to the
// common case: Details with a location map, Data quality collapsed, one
// identification, and no comments yet (card radius matches outlined Paper).
const SECTION_CARD_HEIGHTS = [356, 66, 188, 140];

/**
 * Skeleton loader matching observation detail page layout
 */
export function ObservationDetailSkeleton() {
  return (
    <Box>
      <DetailHeaderSkeleton
        titleWidth={100}
        trailing={<IconButtonSkeleton sx={{ ml: "auto" }} />}
      />

      {/* Species header */}
      <Box sx={{ px: 3, pt: 2, pb: 1.5 }}>
        <Skeleton variant="text" width="40%" height={24} />
        <Skeleton variant="text" width="25%" height={24} />
      </Box>

      <Divider sx={{ mx: 3 }} />

      {/* Observer (name, handle, observed date) with like control */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 3, pt: 1.5, pb: 1.5 }}>
        <UserCardSkeleton
          avatarSize={44}
          nameWidth={120}
          nameHeight={24}
          subtitleWidth={140}
          subtitleHeight={20}
          belowName={<Skeleton variant="text" width={160} height={24} />}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <IconButtonSkeleton />
      </Stack>

      {/* Image + license caption */}
      <Box sx={OBSERVATION_PHOTO_STAGE_SX}>
        <Skeleton
          variant="rectangular"
          height={OBSERVATION_PHOTO_MAX_HEIGHT}
          sx={{ width: "100%", borderRadius: OBSERVATION_PHOTO_RADIUS }}
        />
        <Typography variant="caption" sx={OBSERVATION_PHOTO_LICENSE_SX}>
          <Skeleton width={160} sx={{ mx: "auto" }} />
        </Typography>
      </Box>

      {/* Content: uniform section cards */}
      <Box
        sx={{
          p: { xs: 2, sm: 3 },
          display: "flex",
          flexDirection: "column",
          gap: 2.5,
        }}
      >
        {SECTION_CARD_HEIGHTS.map((height) => (
          <SectionCardSkeleton key={height} height={height} />
        ))}
      </Box>
    </Box>
  );
}
