import { Chip } from "@mui/material";
import type { ChipProps } from "@mui/material";
import { countChipSx } from "./chipSx";

export interface CountChipProps {
  /** The number (or pre-formatted count) to display. */
  count: number | string;
  /** Chip color, e.g. "primary" for an active-filter count. Defaults to MUI's default color. */
  color?: ChipProps["color"];
}

/**
 * Compact numeric badge — the `trailing` count in a `SectionHeader`/
 * `CollapsibleSection`, or an active-filter count pill. Wraps `countChipSx`
 * so call sites don't repeat the size/sx boilerplate.
 */
export function CountChip({ count, color }: CountChipProps) {
  return <Chip label={count} size="small" color={color} sx={countChipSx} />;
}
