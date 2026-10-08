import type { ReactNode } from "react";
import { Typography, Paper, type SxProps, type Theme } from "@mui/material";

interface SettingsSectionProps {
  title: ReactNode;
  description: ReactNode;
  sx?: SxProps<Theme>;
  children: ReactNode;
}

/** Titled, outlined card wrapper shared by the settings page sections. */
export function SettingsSection({ title, description, sx, children }: SettingsSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3, ...sx }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        {description}
      </Typography>
      {children}
    </Paper>
  );
}
