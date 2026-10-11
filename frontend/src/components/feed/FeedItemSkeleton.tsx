import { Box, Card, CardContent, Skeleton } from "@mui/material";
import { UserCardSkeleton } from "../common/UserCardSkeleton";
import { FEED_CARD_SX, FEED_IMAGE_MAX_HEIGHT } from "./feedLayout";

/**
 * Skeleton loader matching FeedItem layout
 */
export function FeedItemSkeleton() {
  return (
    <Card sx={FEED_CARD_SX}>
      {/* Header: avatar, name + handle, timestamp, overflow menu */}
      <Box sx={{ display: "flex", gap: 1, p: 2, alignItems: "flex-start" }}>
        <UserCardSkeleton
          avatarSize={40}
          spacing={1}
          nameWidth="30%"
          nameHeight={24}
          trailingWidth="20%"
          trailingHeight={20}
          subtitleWidth="15%"
          subtitleHeight={20}
          sx={{ flex: 1 }}
        />
        <Skeleton variant="circular" width={30} height={30} />
      </Box>
      {/* Image */}
      <Skeleton variant="rectangular" height={FEED_IMAGE_MAX_HEIGHT} />
      {/* Species name and like button share a row */}
      <CardContent>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Skeleton variant="text" width="40%" height={24} />
          <Skeleton variant="circular" width={30} height={30} />
        </Box>
      </CardContent>
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
