import { Box, type SxProps, type Theme } from "@mui/material";
import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { Wordmark } from "./Wordmark";

interface BrandLockupProps {
  /** Logo mark diameter in pixels (default 32). */
  logoSize?: number;
  onClick?: (() => void) | undefined;
  sx?: SxProps<Theme> | undefined;
  wordmarkSx?: SxProps<Theme> | undefined;
}

/**
 * The app's home link: leaf-eye mark (tinted primary) + wordmark. Shared by
 * `TopBar` and `Sidebar`, which only differ in logo size, link click handler,
 * and outer spacing/hover.
 */
export function BrandLockup({ logoSize = 32, onClick, sx, wordmarkSx }: BrandLockupProps) {
  return (
    <Box
      component={Link}
      to="/"
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        textDecoration: "none",
        ...sx,
      }}
    >
      <Box sx={{ color: "primary.main", display: "inline-flex" }}>
        <Logo size={logoSize} />
      </Box>
      <Wordmark sx={wordmarkSx} />
    </Box>
  );
}
