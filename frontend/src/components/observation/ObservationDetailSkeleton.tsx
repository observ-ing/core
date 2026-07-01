import { Box, Divider, Skeleton } from "@mui/material";
import { detailHeaderSx } from "../common/layoutSx";

/**
 * Skeleton loader matching observation detail page layout
 */
export function ObservationDetailSkeleton() {
  return (
    <Box>
      {/* Header */}
      <Box sx={detailHeaderSx}>
        <Skeleton variant="circular" width={40} height={40} sx={{ mr: 1 }} />
        <Skeleton variant="text" width={100} height={24} />
      </Box>

      {/* Species header */}
      <Box sx={{ px: 3, pt: 2, pb: 1.5 }}>
        <Skeleton variant="text" width="40%" height={32} />
        <Skeleton variant="text" width="25%" height={20} />
      </Box>

      <Divider sx={{ mx: 3 }} />

      {/* Observer + date with like control */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 3, pt: 1.5, pb: 1.5 }}>
        <Skeleton variant="circular" width={44} height={44} />
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width={120} height={20} />
          <Skeleton variant="text" width={140} height={16} />
        </Box>
        <Skeleton variant="circular" width={28} height={28} />
      </Box>

      {/* Image */}
      <Skeleton variant="rectangular" height={400} sx={{ width: "100%" }} />

      {/* Content: uniform section cards */}
      <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
        <Skeleton variant="rectangular" height={56} sx={{ borderRadius: 2 }} />
        <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
      </Box>
    </Box>
  );
}
