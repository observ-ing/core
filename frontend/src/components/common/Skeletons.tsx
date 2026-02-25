import { Box, Card, Divider, Skeleton, Stack } from "@mui/material";

/**
 * Skeleton loader matching FeedItem layout
 */
export function FeedItemSkeleton() {
  return (
    <Card
      sx={{
        mb: 1.5,
        mx: { xs: 0.5, sm: 1 },
        "&:first-of-type": {
          mt: 1.5,
        },
      }}
    >
      <Box sx={{ display: "flex", gap: 1, p: 2 }}>
        <Skeleton variant="circular" width={40} height={40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
            <Skeleton variant="text" width="30%" height={20} />
            <Skeleton variant="text" width="20%" height={16} />
          </Stack>
          <Skeleton variant="text" width="15%" height={16} />
        </Box>
      </Box>
      <Skeleton variant="rectangular" height={280} />
      <Box sx={{ p: 2 }}>
        <Skeleton variant="text" width="45%" height={24} />
      </Box>
    </Card>
  );
}

/**
 * Multiple feed item skeletons for loading states
 */
export function FeedSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <Box>
      {Array.from({ length: count }).map((_, i) => (
        <FeedItemSkeleton key={i} />
      ))}
    </Box>
  );
}

/**
 * Skeleton loader matching profile header layout
 */
export function ProfileHeaderSkeleton() {
  return (
    <Box sx={{ p: 3, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Skeleton variant="circular" width={80} height={80} />
        <Box>
          <Skeleton variant="text" width={180} height={32} />
          <Skeleton variant="text" width={120} height={20} />
        </Box>
      </Stack>
      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        {[1, 2, 3].map((i) => (
          <Box
            key={i}
            sx={{
              textAlign: "center",
              flex: 1,
              bgcolor: "action.hover",
              borderRadius: 2,
              py: 1.5,
              px: 1,
            }}
          >
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

/**
 * Skeleton for profile observation card grid items
 */
export function ProfileObservationCardSkeleton() {
  return (
    <Card>
      <Skeleton variant="rectangular" sx={{ aspectRatio: "1", width: "100%" }} />
      <Box sx={{ p: 1.5 }}>
        <Skeleton variant="text" width="70%" height={20} />
        <Skeleton variant="text" width="50%" height={16} />
      </Box>
    </Card>
  );
}

/**
 * Skeleton for profile identification card grid items
 */
export function ProfileIdentificationCardSkeleton() {
  return (
    <Card>
      <Box
        sx={{
          py: 3,
          px: 1.5,
          bgcolor: "action.hover",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Skeleton variant="circular" width={28} height={28} sx={{ mb: 1 }} />
        <Skeleton variant="text" width="60%" height={20} />
        <Skeleton variant="text" width="40%" height={16} />
      </Box>
      <Box sx={{ p: 1.5 }}>
        <Skeleton variant="text" width="50%" height={16} />
      </Box>
    </Card>
  );
}

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

        {/* Identification section */}
        <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2, mt: 3 }} />
      </Box>
    </Box>
  );
}
