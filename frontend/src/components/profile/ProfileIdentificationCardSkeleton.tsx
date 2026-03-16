import { Box, Card, Skeleton } from "@mui/material";

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
