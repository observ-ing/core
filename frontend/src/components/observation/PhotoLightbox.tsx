import { Box, IconButton, Modal, Fade, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { getLicenseLabel } from "../../lib/licenses";

interface PhotoLightboxProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt?: string | undefined;
  license?: string | undefined;
}

export function PhotoLightbox({ open, onClose, src, alt, license }: PhotoLightboxProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeAfterTransition
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "rgba(0, 0, 0, 0.9)",
      }}
    >
      <Fade in={open}>
        <Box
          onClick={onClose}
          sx={{
            outline: "none",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            p: { xs: 2, sm: 4 },
            cursor: "zoom-out",
          }}
        >
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
            sx={{
              position: "absolute",
              top: 16,
              right: 16,
              color: "common.white",
              bgcolor: "rgba(0, 0, 0, 0.4)",
              "&:hover": { bgcolor: "rgba(0, 0, 0, 0.6)" },
            }}
          >
            <CloseIcon />
          </IconButton>
          <Box
            component="img"
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            sx={{
              maxWidth: "100%",
              maxHeight: license ? "calc(100% - 32px)" : "100%",
              objectFit: "contain",
              cursor: "default",
            }}
          />
          {license && (
            <Typography
              variant="caption"
              onClick={(e) => e.stopPropagation()}
              sx={{
                mt: 1,
                color: "grey.400",
                textAlign: "center",
                cursor: "default",
              }}
            >
              License: {getLicenseLabel(license)}
            </Typography>
          )}
        </Box>
      </Fade>
    </Modal>
  );
}
