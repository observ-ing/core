import { Box, CircularProgress, Tooltip } from "@mui/material";
import { useAppSelector } from "../../store";

// Small TopBar spinner that surfaces background observation submissions. The
// upload modal closes immediately on a successful PDS write and hands the
// ingester poll off to the `pending` slice; this is the only visible trace of
// that in-flight work until the completion toast fires.
export function PendingIndicator() {
  const count = useAppSelector((state) => state.pending.submissions.length);

  if (count === 0) return null;

  return (
    <Tooltip title={`${count} observation${count > 1 ? "s" : ""} processing…`}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
        }}
      >
        <CircularProgress
          size={22}
          thickness={5}
          color="primary"
          aria-label="Submissions processing"
        />
      </Box>
    </Tooltip>
  );
}
