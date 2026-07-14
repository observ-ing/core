import { useState, type MouseEvent } from "react";
import { IconButton, Menu, MenuItem, type SxProps, type Theme } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { getPdslsUrl } from "../../lib/utils";

export interface RecordOverflowMenuProps {
  /** AT URI of the record; builds the "View on AT Protocol" link. */
  atUri: string;
  /** Shows an "Edit" item when provided. */
  onEdit?: (() => void) | undefined;
  /**
   * Shows a "Delete" item when provided. May return a promise; the item
   * disables itself for the duration so a slow delete can't be double-fired.
   */
  onDelete?: (() => void | Promise<void>) | undefined;
  /**
   * Set when this button sits inside another clickable element (e.g. a card
   * that navigates on click) so opening the menu or clicking an item doesn't
   * also trigger the ancestor's handler.
   */
  stopPropagation?: boolean;
  sx?: SxProps<Theme>;
}

export function RecordOverflowMenu({
  atUri,
  onEdit,
  onDelete,
  stopPropagation,
  sx,
}: RecordOverflowMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const open = Boolean(anchorEl);

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    if (stopPropagation) {
      event.preventDefault();
      event.stopPropagation();
    }
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => setAnchorEl(null);

  const handleDelete = async () => {
    handleClose();
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={handleOpen}
        aria-label="More options"
        sx={{ color: "text.disabled", ...sx }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {onEdit && (
          <MenuItem
            onClick={() => {
              handleClose();
              onEdit();
            }}
          >
            Edit
          </MenuItem>
        )}
        {onDelete && (
          <MenuItem onClick={handleDelete} disabled={isDeleting} sx={{ color: "error.main" }}>
            Delete
          </MenuItem>
        )}
        <MenuItem
          component="a"
          href={getPdslsUrl(atUri)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClose}
        >
          View on AT Protocol
        </MenuItem>
      </Menu>
    </>
  );
}
