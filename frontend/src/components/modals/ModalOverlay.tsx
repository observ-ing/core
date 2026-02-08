import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@mui/material";

interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false;
}

export function ModalOverlay({
  isOpen,
  onClose,
  children,
  maxWidth = "sm",
}: ModalOverlayProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      PaperProps={{
        sx: { maxHeight: "90vh" },
      }}
    >
      <DialogContent sx={{ p: 3 }}>{children}</DialogContent>
    </Dialog>
  );
}
