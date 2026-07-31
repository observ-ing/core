import { IconButton } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { SxProps, Theme } from "@mui/material/styles";

export interface ExternalLinkIconButtonProps {
  /** Destination URL; opens in a new tab. */
  href: string;
  /** Name used to build the title/aria-label, e.g. "Open {label} in new tab". */
  label: string;
  /** Icon font size in px. Defaults to 14. */
  fontSize?: number;
  /** Extra sx merged onto the button (e.g. spacing overrides). */
  sx?: SxProps<Theme>;
  /** Mousedown handler override — used by Autocomplete rows to stop the popper from closing before the click fires. */
  onMouseDown?: (e: React.MouseEvent) => void;
}

/**
 * A small "open in new tab" icon button for linking out to a taxon or other
 * external resource. Used inline in cards/rows where a full ExternalLinkChip
 * would be too heavy.
 */
export function ExternalLinkIconButton({
  href,
  label,
  fontSize = 14,
  sx,
  onMouseDown,
}: ExternalLinkIconButtonProps) {
  return (
    <IconButton
      size="small"
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseDown={onMouseDown}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      title={`Open ${label} in new tab`}
      aria-label={`Open ${label} in new tab`}
      sx={{ p: 0.5, flexShrink: 0, ...sx }}
    >
      <OpenInNewIcon sx={{ fontSize }} />
    </IconButton>
  );
}
