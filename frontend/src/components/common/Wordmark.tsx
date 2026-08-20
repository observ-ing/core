import { Box, Typography, type SxProps, type Theme } from "@mui/material";

interface WordmarkProps {
  /** Hide the wordmark text below this breakpoint (icon-only). */
  sx?: SxProps<Theme> | undefined;
}

// The "Observ.ing" wordmark. Set in DM Sans, weight 600. The dot is the brand
// moment — colored in the accent green to draw the eye to the domain structure
// (observ + .ing) — while the rest of the word sits in the primary text color.
export function Wordmark({ sx }: WordmarkProps) {
  return (
    <Typography
      component="span"
      sx={{
        // fontFamily inherits the theme's brand sans stack (DM Sans + fallbacks).
        fontWeight: 600,
        fontSize: "1.125rem",
        lineHeight: 1,
        letterSpacing: "-0.02em",
        color: "text.primary",
        ...sx,
      }}
    >
      Observ
      <Box component="span" sx={{ color: "primary.main" }}>
        .
      </Box>
      ing
    </Typography>
  );
}
