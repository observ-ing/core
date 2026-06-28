import type { ReactNode } from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { gradientFromString } from "../../lib/gradientFromString";

interface GradientSwatchProps {
  /** Seed string the gradient is derived from (stable per value). */
  seed: string;
  /** Square size in px. Defaults to 22. */
  size?: number;
  /** Extra styles (e.g. a selection ring via boxShadow). */
  sx?: SxProps<Theme> | undefined;
  /**
   * Overlay content that covers the gradient — typically a real thumbnail
   * `<img>`. When present the gradient acts as a fallback behind it.
   */
  children?: ReactNode;
}

/**
 * A small rounded square filled with a deterministic gradient
 * ({@link gradientFromString}), used as an image-less avatar/placeholder. Pass
 * a thumbnail as `children` to overlay it; omit for the gradient alone.
 */
export function GradientSwatch({ seed, size = 22, sx, children }: GradientSwatchProps) {
  return (
    <Box
      sx={[
        {
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: 0.625,
          overflow: "hidden",
          background: gradientFromString(seed),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}
