import { Snackbar, Alert } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../store";
import { removeToast } from "../../store/uiSlice";

export function ToastContainer() {
  const toasts = useAppSelector((state) => state.ui.toasts);
  const dispatch = useAppDispatch();

  const currentToast = toasts[0];

  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === "clickaway") return;
    if (currentToast) {
      dispatch(removeToast(currentToast.id));
    }
  };

  return (
    <Snackbar
      open={!!currentToast}
      autoHideDuration={3000}
      onClose={handleClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      sx={{ bottom: { xs: 80, sm: 24 } }}
    >
      {currentToast ? (
        <Alert
          onClose={handleClose}
          severity={currentToast.type === "error" ? "error" : "success"}
          sx={{ minWidth: 200 }}
        >
          {currentToast.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
