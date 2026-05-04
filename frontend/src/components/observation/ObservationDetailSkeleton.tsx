import { Box, Skeleton } from "@mui/material";

/**
 * Skeleton loader matching observation detail page layout
 */
export function ObservationDetailSkeleton() {
  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Skeleton variant="circular" width={40} height={40} sx={{ mr: 1 }} />
        <Skeleton variant="text" width={100} height={24} />
      </Box>

      {/* Species header */}
      <Box sx={{ px: 3, pt: 2, pb: 1 }}>
        <Skeleton variant="text" width="40%" height={32} />
        <Skeleton variant="text" width="25%" height={20} />
      </Box>

      {/* Like button */}
      <Box sx={{ px: 3, pb: 1 }}>
        <Skeleton variant="circular" width={28} height={28} />
      </Box>

      {/* Image */}
      <Skeleton variant="rectangular" height={400} sx={{ width: "100%", bgcolor: "grey.800" }} />

      {/* Content */}
      <Box sx={{ p: 3 }}>
        {/* Observer */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mx: -2, px: 2, py: 1 }}>
          <Skeleton variant="circular" width={40} height={40} />
          <Box>
            <Skeleton variant="text" width={120} height={20} />
            <Skeleton variant="text" width={80} height={16} />
          </Box>
        </Box>

        {/* Details as list items */}
        <Box sx={{ mt: 1 }}>
          {[1, 2, 3].map((i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "flex-start", py: 0.75 }}>
              <Box sx={{ minWidth: 36, mt: 0.5 }}>
                <Skeleton variant="circular" width={18} height={18} />
              </Box>
              <Box>
                <Skeleton variant="text" width={60} height={14} />
                <Skeleton variant="text" width={i === 2 ? 180 : 140} height={20} />
              </Box>
            </Box>
          ))}
        </Box>

        {/* Map */}
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2, ml: 4.5, mb: 1 }} />
      </Box>
    </Box>
  );
}
