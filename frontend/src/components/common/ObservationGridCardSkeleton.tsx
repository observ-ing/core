import { Box, Card, CardContent, Skeleton, Typography } from "@mui/material";
import { observationGridCardContentSx } from "./ObservationGridCard";
import { imageSkeletonOverlaySx } from "./layoutSx";

/**
 * Loading placeholder for ObservationGridCard.
 */
export function ObservationGridCardSkeleton() {
  return (
    <Card sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ position: "relative", aspectRatio: "1", width: "100%" }}>
        <Skeleton variant="rectangular" sx={imageSkeletonOverlaySx} />
      </Box>
      <CardContent sx={observationGridCardContentSx}>
        <Typography variant="body2">
          <Skeleton width="70%" />
        </Typography>
        <Typography variant="caption">
          {/* Inline like the real timestamp, so it sits on the same (taller) body line box. */}
          <Skeleton width="50%" sx={{ display: "inline-block" }} />
        </Typography>
      </CardContent>
    </Card>
  );
}
