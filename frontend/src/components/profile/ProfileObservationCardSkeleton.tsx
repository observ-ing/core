import { Box, Card, Skeleton } from "@mui/material";

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
