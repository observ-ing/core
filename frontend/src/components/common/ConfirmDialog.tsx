import type { ReactNode } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Button,
  CircularProgress,
  useMediaQuery,
  useTheme,
} from "@mui/material";

type ConfirmColor = "primary" | "error" | "warning" | "info" | "success" | "inherit";

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Convenience for a plain text body. Use `children` for richer content. */
  message?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Renders the confirm button in the theme's error color. */
  destructive?: boolean;
  /** Explicit confirm button color; overrides `destructive`. */
  confirmColor?: ConfirmColor;
  /** When true, disables both buttons and shows a spinner on confirm. */
  pending?: boolean;
  /** Label shown on the confirm button while `pending`. */
  pendingLabel?: string;
}

export function ConfirmDialog({
  open,
  title,
  message,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
  confirmColor,
  pending = false,
  pendingLabel,
}: ConfirmDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  const resolvedConfirmColor: ConfirmColor = confirmColor ?? (destructive ? "error" : "primary");

  const handleCancel = () => {
    if (!pending) onCancel();
  };

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {message !== undefined ? <Typography>{message}</Typography> : children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleCancel} disabled={pending} color="inherit">
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          color={resolvedConfirmColor}
          variant="contained"
          disabled={pending}
          startIcon={pending ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
