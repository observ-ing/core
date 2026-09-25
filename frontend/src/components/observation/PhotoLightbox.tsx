import { Box, Modal, Fade, Typography, useTheme } from "@mui/material";
import { getLicenseLabel } from "../../lib/licenses";
import { CloseIconButton } from "../common/CloseIconButton";

interface PhotoLightboxProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt?: string | undefined;
  license?: string | undefined;
}

export function PhotoLightbox({ open, onClose, src, alt, license }: PhotoLightboxProps) {
  const theme = useTheme();
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeAfterTransition
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: theme.palette.overlay["scrim"],
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
          <CloseIconButton
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            sx={{
              position: "absolute",
              top: 16,
              right: 16,
              color: "common.white",
              bgcolor: theme.palette.overlay["chip"],
              "&:hover": { bgcolor: theme.palette.overlay["chipHover"] },
            }}
          />
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
                color: theme.palette.overlay["caption"],
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
