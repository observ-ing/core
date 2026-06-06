import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Typography, Button, Stack } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlined";

interface Props {
  children: ReactNode;
  // When this value changes the boundary clears its error and re-renders its
  // children. App passes the current pathname so navigating away from a broken
  // route recovers without a full reload.
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

// A failed lazy import() (stale chunk after a redeploy, flaky network) rejects
// and bubbles up as a render error. Catch it here so a single broken chunk
// recovers with a reload instead of unmounting the whole app to a blank screen.
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  // Clear the error when resetKey changes (App passes the pathname) so
  // navigating away from a broken route recovers without a full reload.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Chunk-load failures are fixed by reloading (the service worker fetches
    // the current chunk hashes); generic render errors get the same escape
    // hatch plus a path home.
    const isChunkError = /loading.*chunk|dynamically imported module|importing a module/i.test(
      error.message,
    );

    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          p: 4,
          textAlign: "center",
        }}
      >
        <Box
          sx={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            bgcolor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            mb: 3,
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 60, color: "text.disabled" }} />
        </Box>
        <Typography variant="h6" component="h2" sx={{ color: "text.secondary", mb: 1 }}>
          {isChunkError ? "Update available" : "Something went wrong"}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.disabled", mb: 4, maxWidth: 360 }}>
          {isChunkError
            ? "This page couldn't load, likely because a new version was just released. Reload to get the latest."
            : "An unexpected error occurred while loading this page."}
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button
            onClick={() => window.location.reload()}
            variant="contained"
            color="primary"
            sx={{ px: 4, py: 1, fontWeight: 600 }}
          >
            Reload
          </Button>
          <Button
            onClick={() => window.location.assign("/")}
            variant="outlined"
            color="inherit"
            sx={{ px: 3 }}
          >
            Go home
          </Button>
        </Stack>
      </Box>
    );
  }
}
