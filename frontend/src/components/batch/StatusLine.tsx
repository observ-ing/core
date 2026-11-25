import type { ReactNode } from "react";
import { Typography } from "@mui/material";

interface StatusLineProps {
  /** Leading glyph, sized by the caller to the line (`miniIconSx`, `captionIconSx`, `fontSize="small"`). */
  icon: ReactNode;
  /** Palette color for the label and icon, e.g. `"error.main"`; inherits the surrounding text color when omitted. */
  color?: string;
  /** Text size of the surrounding row: `caption` on phone grid tiles, `body2` on desktop batch cards, `body1` in the uploader header. */
  variant?: "caption" | "body2" | "body1";
  children: ReactNode;
}

/**
 * Bold icon-plus-label status row on the batch uploader ("Queued", "Uploaded",
 * "Upload failed", "Needs a location"), shared by the desktop batch cards, the
 * uploader header and the phone grid tiles so the weight, alignment and
 * icon gap stay in step. The gap widens at `body1` to match the larger glyph.
 */
export function StatusLine({ icon, color, variant = "body2", children }: StatusLineProps) {
  return (
    <Typography
      variant={variant}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: variant === "body1" ? 0.75 : 0.5,
        fontWeight: 600,
        color,
      }}
    >
      {icon}
      {children}
    </Typography>
  );
}
