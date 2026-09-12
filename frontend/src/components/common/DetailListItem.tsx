import type { ReactNode } from "react";
import { ListItem, ListItemIcon, ListItemText } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

export interface DetailListItemProps {
  /** Leading icon, already sized/colored by the caller (see {@link detailIconSx}). */
  icon: ReactNode;
  primary: ReactNode;
  secondary: ReactNode;
}

/** Shared sizing for a {@link DetailListItem}'s leading icon. */
export const detailIconSx: SxProps<Theme> = { fontSize: 18, color: "text.secondary" };

/**
 * Icon + label + value row for the observation Details list (quantity,
 * coordinates, …). Factored out so the icon gutter and label/value text
 * treatment can't drift between rows the way they did before.
 */
export function DetailListItem({ icon, primary, secondary }: DetailListItemProps) {
  return (
    <ListItem disableGutters alignItems="flex-start">
      <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>{icon}</ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{
          primary: { variant: "caption", color: "text.secondary" },
          secondary: { variant: "body1", color: "text.primary", component: "div" },
        }}
      />
    </ListItem>
  );
}
