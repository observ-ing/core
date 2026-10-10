import { Box, Divider, Skeleton } from "@mui/material";
import { DetailHeaderSkeleton } from "../common/DetailHeaderSkeleton";
import { UserCardSkeleton } from "../common/UserCardSkeleton";

// Placeholder heights for the section cards below the image (card radius matches outlined Paper).
const SECTION_CARD_HEIGHTS = [220, 56, 120];

/**
 * Skeleton loader matching observation detail page layout
 */
export function ObservationDetailSkeleton() {
  return (
    <Box>
      <DetailHeaderSkeleton titleWidth={100} />

      {/* Species header */}
      <Box sx={{ px: 3, pt: 2, pb: 1.5 }}>
        <Skeleton variant="text" width="40%" height={32} />
        <Skeleton variant="text" width="25%" height={20} />
      </Box>

      <Divider sx={{ mx: 3 }} />

      {/* Observer + date with like control */}
      <Box sx={{ px: 3, pt: 1.5, pb: 1.5 }}>
        <UserCardSkeleton
          avatarSize={44}
          nameWidth={120}
          subtitleWidth={140}
          endAdornment={<Skeleton variant="circular" width={28} height={28} />}
        />
      </Box>

      {/* Image */}
      <Skeleton variant="rectangular" height={400} sx={{ width: "100%" }} />

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
          <Skeleton key={height} variant="rectangular" height={height} sx={{ borderRadius: 2 }} />
        ))}
      </Box>
    </Box>
  );
}
