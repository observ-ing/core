import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";

export function RowDetailDialog({
  title,
  data,
  loading,
  error,
  onClose,
}: {
  title: string;
  data: unknown;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>{title}</DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {!loading && !error && (
          <Box
            component="pre"
            sx={{
              fontSize: "0.8rem",
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              m: 0,
              p: 2,
              bgcolor: "action.hover",
              borderRadius: 1,
              maxHeight: "70vh",
              overflow: "auto",
            }}
          >
            {JSON.stringify(data, null, 2)}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
