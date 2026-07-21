import { Box, Typography, Stack } from "@mui/material";
import type { ReactNode } from "react";

export interface FullPageStatusProps {
  /** Icon rendered inside the circular badge, e.g. an MUI icon element. */
  icon: ReactNode;
  /** Optional content rendered between the icon badge and the title, e.g. a "404" mark. */
  eyebrow?: ReactNode;
  /** Heading text. */
  title: ReactNode;
  /** Supporting copy shown below the title. */
  description: ReactNode;
  /** Max width applied to the description so long copy doesn't stretch full-bleed. */
  descriptionMaxWidth?: number;
  /** Action buttons rendered in a row below the description. */
  actions: ReactNode;
}

/**
 * Full-page centered status layout (icon badge, heading, copy, action row) used
 * for error/not-found style pages. For inline empty states within a list or
 * feed, use `EmptyState` instead.
 */
export function FullPageStatus({
  icon,
  eyebrow,
  title,
  description,
  descriptionMaxWidth = 360,
  actions,
}: FullPageStatusProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        p: 4,
        textAlign: "center",
      }}
    >
      <Box
        sx={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mb: 3,
        }}
      >
        {icon}
      </Box>
      {eyebrow}
      <Typography variant="h6" component="h2" sx={{ color: "text.secondary", mb: 1 }}>
        {title}
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: "text.disabled", mb: 4, maxWidth: descriptionMaxWidth }}
      >
        {description}
      </Typography>
      <Stack direction="row" spacing={2}>
        {actions}
      </Stack>
    </Box>
  );
}
