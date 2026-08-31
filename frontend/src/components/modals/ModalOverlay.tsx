import type { ReactNode } from "react";
import { Dialog, DialogContent, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useMobileFullScreen } from "../../hooks/useMobileFullScreen";

interface ModalOverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false;
}

export function ModalOverlay({ open, onClose, children, maxWidth = "sm" }: ModalOverlayProps) {
  const fullScreen = useMobileFullScreen();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      fullScreen={fullScreen}
      slotProps={{
        paper: { sx: fullScreen ? undefined : { maxHeight: "90vh" } },
      }}
    >
      <IconButton
        aria-label="Close"
        onClick={onClose}
        sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
      >
        <CloseIcon />
      </IconButton>
      <DialogContent sx={{ p: 3 }}>{children}</DialogContent>
    </Dialog>
  );
}
