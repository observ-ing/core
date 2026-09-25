import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@mui/material";
import { useMobileFullScreen } from "../../hooks/useMobileFullScreen";
import { CloseIconButton } from "../common/CloseIconButton";

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
      <CloseIconButton
        onClick={onClose}
        sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
      />
      <DialogContent sx={{ p: 3 }}>{children}</DialogContent>
    </Dialog>
  );
}
