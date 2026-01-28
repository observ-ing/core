import { Box, Skeleton, Stack, Paper } from "@mui/material";

/**
 * Skeleton loader matching FeedItem layout
 */
export function FeedItemSkeleton() {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.5,
        p: 2,
        bgcolor: "background.paper",
        borderRadius: 2,
        mb: 2,
        mx: { xs: 1, sm: 2 },
        boxShadow: 1,
      }}
    >
      <Skeleton variant="circular" width={48} height={48} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Skeleton variant="text" width="30%" height={20} />
          <Skeleton variant="text" width="20%" height={16} />
          <Skeleton variant="text" width="10%" height={16} />
        </Stack>
        <Skeleton variant="text" width="45%" height={24} sx={{ mb: 0.5 }} />
        <Skeleton variant="text" width="70%" height={18} />
        <Skeleton
          variant="rectangular"
          height={200}
          sx={{ borderRadius: 2, mt: 1.5 }}
        />
      </Box>
    </Box>
  );
}

/**
 * Multiple feed item skeletons for loading states
 */
export function FeedSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <Box sx={{ pt: 2 }}>
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
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="50%" height={32} />
          <Skeleton variant="text" width="30%" height={20} />
        </Box>
      </Stack>
      <Stack direction="row" spacing={4} sx={{ mt: 2 }}>
        {[1, 2, 3].map((i) => (
          <Box key={i} sx={{ textAlign: "center", flex: 1 }}>
            <Skeleton variant="text" width="60%" height={28} sx={{ mx: "auto" }} />
            <Skeleton variant="text" width="80%" height={16} sx={{ mx: "auto" }} />
          </Box>
        ))}
      </Stack>
      <Skeleton
        variant="rectangular"
        width={160}
        height={32}
        sx={{ borderRadius: 1, mt: 2 }}
      />
    </Box>
  );
}

/**
 * Skeleton for profile feed items
 */
export function ProfileFeedItemSkeleton() {
  return (
    <Box
      sx={{
        display: "block",
        p: 2,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 4, mb: 1 }} />
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="60%" height={24} />
          <Skeleton variant="text" width="40%" height={16} />
        </Box>
        <Skeleton variant="rectangular" width={60} height={60} sx={{ borderRadius: 1 }} />
      </Stack>
    </Box>
  );
}

/**
 * Skeleton loader matching taxon detail page layout
 */
export function TaxonDetailSkeleton() {
  return (
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

      {/* Classification section */}
      <Box sx={{ mt: 3 }}>
        <Skeleton variant="text" width={100} height={16} />
        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5, gap: 0.5 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} variant="rectangular" width={70} height={24} sx={{ borderRadius: 4 }} />
          ))}
        </Stack>
      </Box>

      {/* Media gallery */}
      <Box sx={{ mt: 3 }}>
        <Skeleton variant="text" width={60} height={16} />
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rectangular" width={150} height={100} sx={{ borderRadius: 1, flexShrink: 0 }} />
          ))}
        </Stack>
      </Box>

      {/* Description */}
      <Box sx={{ mt: 3 }}>
        <Skeleton variant="text" width={80} height={16} />
        <Skeleton variant="text" width="100%" height={20} sx={{ mt: 1 }} />
        <Skeleton variant="text" width="90%" height={20} />
        <Skeleton variant="text" width="70%" height={20} />
      </Box>

      {/* Button */}
      <Skeleton variant="rectangular" width={120} height={32} sx={{ borderRadius: 1, mt: 3 }} />
    </Box>
  );
}

/**
 * Skeleton loader matching observation detail page layout
 */
export function ObservationDetailSkeleton() {
  return (
    <Box>
      {/* Image skeleton */}
      <Skeleton
        variant="rectangular"
        height={300}
        sx={{ width: "100%" }}
      />

      {/* Content skeleton */}
      <Box sx={{ p: 3 }}>
        {/* Observer */}
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
          <Skeleton variant="circular" width={40} height={40} />
          <Box>
            <Skeleton variant="text" width={120} height={20} />
            <Skeleton variant="text" width={80} height={16} />
          </Box>
        </Stack>

        {/* Details */}
        <Stack spacing={2}>
          {[1, 2, 3, 4].map((i) => (
            <Box key={i}>
              <Skeleton variant="text" width={80} height={14} sx={{ mb: 0.5 }} />
              <Skeleton variant="text" width={i === 3 ? "50%" : "70%"} height={20} />
            </Box>
          ))}
        </Stack>

        {/* Map placeholder */}
        <Skeleton
          variant="rectangular"
          height={200}
          sx={{ borderRadius: 2, mt: 2 }}
        />

        {/* Species */}
        <Box sx={{ mt: 3 }}>
          <Skeleton variant="text" width="40%" height={32} />
        </Box>

        {/* Identification panel placeholder */}
        <Skeleton
          variant="rectangular"
          height={100}
          sx={{ borderRadius: 2, mt: 3 }}
        />
      </Box>
    </Box>
  );
}
