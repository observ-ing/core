import { useNavigate, useLocation } from "react-router-dom";
import { Typography } from "@mui/material";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeDeleteConfirm } from "../../store/uiSlice";
import { checkAuth } from "../../store/authSlice";
import { useDeleteObservation } from "../../lib/query/mutations";
import { getErrorMessage } from "../../lib/utils";
import { useToast } from "../../hooks/useToast";

export function DeleteConfirmDialog() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const observation = useAppSelector((state) => state.ui.deleteConfirmObservation);
  const deleteObs = useDeleteObservation();
  const isDeleting = deleteObs.isPending;

  const isOpen = !!observation;

  const handleClose = () => {
    if (!isDeleting) {
      dispatch(closeDeleteConfirm());
    }
  };

  const handleConfirmDelete = () => {
    if (!observation) return;

    // The hook waits for the ingester to drop the row, then drops the detail
    // cache and refetches the feeds so the observation disappears everywhere.
    deleteObs.mutate(observation.uri, {
      onSuccess: () => {
        toast.success("Observation deleted successfully");
        dispatch(closeDeleteConfirm());

        // If we were on the deleted observation's detail page, leave it.
        if (location.pathname.includes("/observation/")) {
          navigate("/");
        }
      },
      onError: (error) => {
        const message = getErrorMessage(error, "Failed to delete observation");
        toast.error(message);
        if (message.includes("Session expired")) {
          dispatch(checkAuth());
        }
      },
    });
  };

  const species =
    observation?.communityId || observation?.effectiveTaxonomy?.scientificName || "Unidentified";

  return (
    <ConfirmDialog
      open={isOpen}
      onCancel={handleClose}
      onConfirm={handleConfirmDelete}
      title="Delete Observation?"
      confirmLabel="Delete"
      pendingLabel="Deleting..."
      destructive
      pending={isDeleting}
    >
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
    </ConfirmDialog>
  );
}
