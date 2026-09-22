import { useMediaQuery, useTheme } from "@mui/material";

/**
 * Whether a Dialog should render fullscreen at the current viewport size —
 * the `sm` breakpoint, shared by every modal so they switch to fullscreen
 * together.
 */
export function useMobileFullScreen(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"));
}
