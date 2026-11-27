import { CircularProgress, Typography } from "@mui/material";
import { plural } from "../../lib/utils";

interface ConvertingStatusProps {
  /** HEIC photos still being converted; renders nothing at 0. */
  count: number;
  /** Text size of the surrounding row: `body1` beside the uploader headers, `body2` among the phone grid's filter chips. */
  variant?: "body1" | "body2";
}

/**
 * Live "Converting N HEIC photos…" line shown while picked HEIC photos are
 * converted to JPEG, shared by the desktop uploader header and the phone
 * start/grid screens. The spinner is sized to the text so it sits on the
 * line's x-height at either variant.
 */
export function ConvertingStatus({ count, variant = "body1" }: ConvertingStatusProps) {
  if (count <= 0) return null;
  return (
    <Typography
      role="status"
      variant={variant}
      sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}
    >
      <CircularProgress size={variant === "body2" ? 14 : 16} color="inherit" />
      Converting {plural(count, "HEIC photo")}…
    </Typography>
  );
}
