import { Box, Card, CardContent, Skeleton, Typography } from "@mui/material";
import { observationGridCardContentSx } from "../common/ObservationGridCard";
import { PROFILE_ID_CARD_HEADER_SX } from "./profileLayout";

/**
 * Skeleton for profile identification card grid items
 */
export function ProfileIdentificationCardSkeleton() {
  return (
    <Card>
      <Box sx={PROFILE_ID_CARD_HEADER_SX}>
        <Skeleton variant="circular" width={28} height={28} sx={{ mb: 1 }} />
        <Skeleton variant="text" width="60%" height={20} />
      </Box>
      <CardContent sx={observationGridCardContentSx}>
        <Typography variant="caption">
          {/* Inline like the real timestamp, so it sits on the same (taller) body line box. */}
          <Skeleton width="50%" sx={{ display: "inline-block" }} />
        </Typography>
      </CardContent>
    </Card>
  );
}
