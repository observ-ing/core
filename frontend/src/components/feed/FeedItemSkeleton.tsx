import { Box, Card, Skeleton } from "@mui/material";
import { UserCardSkeleton } from "../common/UserCardSkeleton";
import { FEED_CARD_SX, FEED_IMAGE_MAX_HEIGHT } from "./feedLayout";

/**
 * Skeleton loader matching FeedItem layout
 */
export function FeedItemSkeleton() {
  return (
    <Card sx={FEED_CARD_SX}>
      {/* CardHeader: avatar, name/handle, timestamp */}
      <Box sx={{ p: 2 }}>
        <UserCardSkeleton
          avatarSize={40}
          spacing={1}
          nameWidth="30%"
          trailingWidth="20%"
          subtitleWidth="15%"
        />
      </Box>
      {/* Image */}
      <Skeleton variant="rectangular" height={FEED_IMAGE_MAX_HEIGHT} />
      {/* CardContent: species, remarks, location */}
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Skeleton variant="text" width="45%" height={24} />
        <Skeleton variant="text" width="90%" height={18} sx={{ mt: 0.5 }} />
        <Skeleton variant="text" width="70%" height={18} />
        <Skeleton variant="text" width="35%" height={16} sx={{ mt: 0.5 }} />
      </Box>
      {/* CardActions: like button */}
      <Box sx={{ px: 1, pb: 1 }}>
        <Skeleton variant="circular" width={28} height={28} />
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
