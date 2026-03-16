import { Box, Divider, Skeleton, Stack } from "@mui/material";
import { FeedItemSkeleton } from "../feed/FeedItemSkeleton";

/**
 * Skeleton loader matching taxon detail page layout
 */
export function TaxonDetailSkeleton() {
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
        <Skeleton variant="text" width={60} height={24} />
      </Box>

      {/* Main content */}
      <Box sx={{ p: 3 }}>
        {/* Scientific name */}
        <Skeleton variant="text" width="60%" height={36} />
        {/* Common name */}
        <Skeleton variant="text" width="40%" height={28} sx={{ mt: 0.5 }} />

        {/* Chips */}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Skeleton variant="rectangular" width={60} height={24} sx={{ borderRadius: 4 }} />
          <Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 4 }} />
        </Stack>

        {/* Stats */}
        <Skeleton variant="text" width="50%" height={20} sx={{ mt: 2 }} />

        {/* Classification accordion */}
        <Skeleton variant="rectangular" height={48} sx={{ borderRadius: 1, mt: 3 }} />

        {/* Media accordion */}
        <Skeleton variant="rectangular" height={48} sx={{ borderRadius: 1, mt: 0.5 }} />

        {/* External links */}
        <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
          <Skeleton variant="rectangular" width={130} height={32} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" width={150} height={32} sx={{ borderRadius: 1 }} />
        </Stack>
      </Box>

      {/* Observations section */}
      <Divider />
      <Box sx={{ px: 3, py: 2 }}>
        <Skeleton variant="text" width={160} height={20} />
      </Box>
      <FeedItemSkeleton />
      <FeedItemSkeleton />
    </Box>
  );
}
