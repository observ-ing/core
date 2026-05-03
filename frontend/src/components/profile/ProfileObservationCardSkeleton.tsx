import { Box, Card, CardContent, Skeleton, Typography } from "@mui/material";

/**
 * Skeleton for profile observation card grid items
 */
export function ProfileObservationCardSkeleton() {
  return (
    <Card sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ position: "relative", aspectRatio: "1", width: "100%" }}>
        <Skeleton
          variant="rectangular"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </Box>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, flex: 1 }}>
        <Typography variant="body2">
          <Skeleton width="70%" />
        </Typography>
        <Typography variant="caption">
          <Skeleton width="50%" />
        </Typography>
      </CardContent>
    </Card>
  );
}
