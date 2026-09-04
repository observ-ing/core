import { Box, Card, CardContent, Skeleton } from "@mui/material";
import { observationGridCardContentSx } from "../common/ObservationGridCard";

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
      </Box>
      <CardContent sx={observationGridCardContentSx}>
        <Skeleton variant="text" width="50%" height={16} />
      </CardContent>
    </Card>
  );
}
