import { CircularProgress } from "@mui/material";

/**
 * Small inline spinner for a `Button`'s `startIcon` while an action is
 * pending — inherits the button's text color so it reads correctly on both
 * contained and outlined/text variants.
 */
export function ButtonSpinner({ size = 16 }: { size?: number }) {
  return <CircularProgress size={size} color="inherit" />;
}
