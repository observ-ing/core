import { Box, Card, CardContent, Skeleton, Typography } from "@mui/material";
import { observationGridCardContentSx } from "./ObservationGridCard";

/**
 * Loading placeholder for ObservationGridCard.
 */
export function ObservationGridCardSkeleton() {
  return (
    <Card sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ position: "relative", aspectRatio: "1", width: "100%" }}>
        <Skeleton
          variant="rectangular"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </Box>
      <CardContent sx={observationGridCardContentSx}>
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
