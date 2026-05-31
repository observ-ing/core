import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Button,
  CircularProgress,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeDeleteConfirm, addToast } from "../../store/uiSlice";
import { checkAuth } from "../../store/authSlice";
import { deleteObservation, pollObservation } from "../../services/api";
import { invalidateOccurrenceLists, removeObservation } from "../../lib/query/occurrenceCache";
import { getErrorMessage } from "../../lib/utils";

export function DeleteConfirmDialog() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const observation = useAppSelector((state) => state.ui.deleteConfirmObservation);
  const [isDeleting, setIsDeleting] = useState(false);

  const isOpen = !!observation;

  const handleClose = () => {
    if (!isDeleting) {
      dispatch(closeDeleteConfirm());
    }
  };

  const handleConfirmDelete = async () => {
    if (!observation) return;

    setIsDeleting(true);
    try {
      await deleteObservation(observation.uri);

      // Wait for the ingester to remove the row; refreshing the feed caches
      // before this would otherwise briefly show the deleted observation.
      await pollObservation(observation.uri, (r) => !r?.occurrence);

      // Drop the detail cache and refetch the feeds so the observation
      // disappears everywhere — no full-page reload needed.
      removeObservation(observation.uri);
      await invalidateOccurrenceLists();

      dispatch(
        addToast({
          message: "Observation deleted successfully",
          type: "success",
        }),
      );
      dispatch(closeDeleteConfirm());

      // If we were on the deleted observation's detail page, leave it.
      if (location.pathname.includes("/observation/")) {
        navigate("/");
      }
    } catch (error) {
      const message = getErrorMessage(error, "Failed to delete observation");
      dispatch(addToast({ message, type: "error" }));
      if (message.includes("Session expired")) {
        dispatch(checkAuth());
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const species =
    observation?.communityId || observation?.effectiveTaxonomy?.scientificName || "Unidentified";

  return (
    <Dialog open={isOpen} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Observation?</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete this observation of <strong>{species}</strong>?
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 1,
          }}
        >
          This action cannot be undone. All identifications and comments will also be deleted.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={isDeleting} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleConfirmDelete}
          color="error"
          variant="contained"
          disabled={isDeleting}
          startIcon={isDeleting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
