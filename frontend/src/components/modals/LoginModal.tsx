import { useState, FormEvent } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
  Box,
  Link,
  Alert,
  CircularProgress,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeLoginModal } from "../../store/uiSlice";
import { initiateLogin } from "../../services/api";

export function LoginModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.loginModalOpen);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleClose = () => {
    dispatch(closeLoginModal());
    setHandle("");
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed) return;

    setError(null);
    setIsLoading(true);

    try {
      const { url } = await initiateLogin(trimmed);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate login");
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Log in</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Observ.ing uses the{" "}
            <Link
              href="https://atproto.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              AT Protocol
            </Link>
            . You can log in with any compatible service, including Bluesky.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            fullWidth
            label="Your handle"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              if (error) setError(null);
            }}
            placeholder="alice.bsky.social"
            helperText={
              <Box component="span">
                Examples: alice.bsky.social, bob.us-west.host.bsky.network, carol.example.com
              </Box>
            }
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            margin="normal"
            autoFocus
            disabled={isLoading}
            error={!!error}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} color="inherit" disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={!handle.trim() || isLoading}
            startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {isLoading ? "Connecting..." : "Continue"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
