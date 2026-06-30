import { Box, Button, CircularProgress } from "@mui/material";

export interface LoadMoreButtonProps {
  /** Whether the next page is currently being fetched (shows a spinner and disables the button). */
  loading: boolean;
  /** Invoked when the button is clicked to fetch the next page. */
  onClick: () => void;
}

/**
 * Centered "Load more" pagination button with an inline spinner while loading,
 * matching the look used by the taxon detail observation lists. Render it
 * behind a `hasMore` guard at the call site.
 */
export function LoadMoreButton({ loading, onClick }: LoadMoreButtonProps) {
  return (
    <Box sx={{ p: 2, textAlign: "center" }}>
      <Button variant="text" onClick={onClick} disabled={loading}>
        {loading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
        Load more
      </Button>
    </Box>
  );
}
