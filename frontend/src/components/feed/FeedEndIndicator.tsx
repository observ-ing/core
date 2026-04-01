import { Box, Typography } from "@mui/material";

interface FeedEndIndicatorProps {
  count?: number;
}

export function FeedEndIndicator({ count }: FeedEndIndicatorProps) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", p: 3, pb: 4 }}>
      <Typography variant="body2" color="text.disabled">
        {count != null
          ? `You've reached the end — ${count} observations`
          : "You've reached the end"}
      </Typography>
    </Box>
  );
}
