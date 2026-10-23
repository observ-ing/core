// Scaffolding shared by the phone layout's screens: a full-screen step with a
// back button in its header, and the bar of actions pinned under a screen.
import type { ReactNode } from "react";
import { Box, Button, IconButton, Typography, type ButtonProps } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { phoneCaptionFontSize } from "../../common/layoutSx";

/** Clears the home indicator on phones that draw one over the page. */
const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";

export interface BottomBarProps {
  children: ReactNode;
}

export function BottomBar({ children }: BottomBarProps) {
  return (
    <Box
      component="footer"
      sx={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        px: 2,
        pt: 1.25,
        pb: `calc(12px + ${SAFE_BOTTOM})`,
        bgcolor: "background.paper",
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      {children}
    </Box>
  );
}

/** A bar action with its icon above its label, so four fit across a phone. */
export function StackedAction({ startIcon, children, sx, ...props }: ButtonProps) {
  return (
    <Button
      color="inherit"
      {...props}
      sx={[
        {
          flex: 1,
          minWidth: 0,
          minHeight: 60,
          flexDirection: "column",
          gap: 0.5,
          px: 0.5,
          fontSize: phoneCaptionFontSize,
          lineHeight: 1.2,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {startIcon}
      {children}
    </Button>
  );
}

export interface PhoneStepProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The subtitle says something is missing. */
  subtitleWarns?: boolean;
  /** What the back button does, for screen readers, e.g. "Back to batch". */
  backLabel: string;
  onBack: () => void;
  /** Buttons at the end of the header. */
  actions?: ReactNode;
  /** Contents of a bar pinned to the bottom. */
  footer?: ReactNode;
  children: ReactNode;
}

export function PhoneStep({
  title,
  subtitle,
  subtitleWarns = false,
  backLabel,
  onBack,
  actions,
  footer,
  children,
}: PhoneStepProps) {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      <Box
        component="header"
        sx={{
          flexShrink: 0,
          minHeight: 56,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <IconButton onClick={onBack} aria-label={backLabel} color="inherit">
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" noWrap sx={{ fontWeight: 700, fontSize: 17 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography
              noWrap
              sx={{
                fontSize: phoneCaptionFontSize,
                fontWeight: subtitleWarns ? 600 : 400,
                color: subtitleWarns ? "warning.main" : "text.secondary",
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions}
      </Box>
      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          p: 2,
        }}
      >
        {children}
      </Box>
      {footer && <BottomBar>{footer}</BottomBar>}
    </Box>
  );
}
