import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { SxProps, Theme } from "@mui/material/styles";

export interface CloseIconButtonProps {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Overrides the default "Close" aria-label, e.g. for a more specific action. */
  "aria-label"?: string;
  /** Extra sx merged onto the button (e.g. positioning, color overrides). */
  sx?: SxProps<Theme>;
}

/**
 * A small "X" icon button for dismissing modals, overlays, and lightboxes.
 * Centralizes the CloseIcon + aria-label pairing repeated across those surfaces.
 */
export function CloseIconButton({
  onClick,
  "aria-label": ariaLabel = "Close",
  sx,
}: CloseIconButtonProps) {
  return (
    <IconButton onClick={onClick} aria-label={ariaLabel} sx={sx}>
      <CloseIcon />
    </IconButton>
  );
}
