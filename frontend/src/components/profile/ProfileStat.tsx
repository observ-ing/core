import type SvgIcon from "@mui/material/SvgIcon";
import { Box, Stack, Typography } from "@mui/material";
import { PROFILE_STAT_BOX_SX, PROFILE_STAT_ICON_SX, PROFILE_STAT_ROW_SX } from "./profileLayout";

interface ProfileStatProps {
  count: number;
  color: string;
  icon: typeof SvgIcon;
  label: string;
}

/**
 * Single stat box (count + icon + label) used in the profile header stats row.
 */
export function ProfileStat({ count, color, icon: Icon, label }: ProfileStatProps) {
  return (
    <Box sx={PROFILE_STAT_BOX_SX}>
      <Typography variant="h6" component="span" sx={{ fontWeight: 700, color }}>
        {count.toLocaleString()}
      </Typography>
      <Stack direction="row" spacing={0.5} sx={PROFILE_STAT_ROW_SX}>
        <Icon sx={PROFILE_STAT_ICON_SX} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
      </Stack>
    </Box>
  );
}
