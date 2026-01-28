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
import { deleteObservation } from "../../services/api";

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

      dispatch(
        addToast({
          message: "Observation deleted successfully",
          type: "success",
        })
      );
      dispatch(closeDeleteConfirm());

      // Navigate away if on the observation detail page
      const isOnDetailPage = location.pathname.includes("/observation/");
      if (isOnDetailPage) {
        navigate("/");
      } else {
        // Reload the page to refresh the feed
        window.location.reload();
      }
    } catch (error) {
      dispatch(
        addToast({
          message:
            error instanceof Error ? error.message : "Failed to delete observation",
          type: "error",
        })
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const species =
    observation?.communityId || observation?.scientificName || "Unidentified";

  return (
    <Dialog open={isOpen} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Observation?</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete this observation of{" "}
          <strong>{species}</strong>?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          This action cannot be undone. All identifications and comments will
          also be deleted.
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
          startIcon={
            isDeleting ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
