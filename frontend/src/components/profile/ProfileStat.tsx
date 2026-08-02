import type { ReactElement } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { PROFILE_STAT_BOX_SX } from "./profileLayout";

interface ProfileStatProps {
  count: number;
  color: string;
  icon: ReactElement;
  label: string;
}

/**
 * Single stat box (count + icon + label) used in the profile header stats row.
 */
export function ProfileStat({ count, color, icon, label }: ProfileStatProps) {
  return (
    <Box sx={PROFILE_STAT_BOX_SX}>
      <Typography variant="h6" component="span" sx={{ fontWeight: 700, color }}>
        {count.toLocaleString()}
      </Typography>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{
          alignItems: "center",
          justifyContent: "center",
          mt: 0.5,
        }}
      >
        {icon}
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
      </Stack>
    </Box>
  );
}
