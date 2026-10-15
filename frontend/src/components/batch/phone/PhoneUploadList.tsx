// Phone layout, during and after an upload: the observations as rows, not the
// grid, so status and error text have room. Uploaded ones leave the list.
import { Link } from "react-router-dom";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import { coverImageSx } from "../../common/layoutSx";
import { shouldItalicizeTaxonName } from "../../common/TaxonLink";
import { isReading, missingFields, type BatchObservation } from "../../../lib/batchUpload";
import { plural } from "../../../lib/utils";
import { formatBatchDate } from "../BatchCard";
import { BottomBar } from "./PhoneStep";

export interface PhoneUploadListProps {
  /** Every observation not yet uploaded: on its way up, or failed. */
  observations: BatchObservation[];
  uploadedCount: number;
  uploading: boolean;
  /** Retrying can't start yet, e.g. the saved license hasn't loaded. */
  blocked: boolean;
  /** Where the uploaded observations can be seen. */
  profilePath: string;
  onCancel: () => void;
  onEdit: (id: string) => void;
  onRetry: (observation: BatchObservation) => void;
  onRetryAll: () => void;
  onRemove: (observation: BatchObservation) => void;
}

function Thumbnail({ observation }: { observation: BatchObservation }) {
  return (
    <Box sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1, overflow: "hidden" }}>
      <Box component="img" src={observation.photos[0]?.previewUrl} alt="" sx={coverImageSx} />
    </Box>
  );
}

function Name({ observation }: { observation: BatchObservation }) {
  const { name, match, rank } = observation.taxon;
  return (
    <Typography
      noWrap
      sx={{
        fontWeight: 600,
        fontStyle:
          name && shouldItalicizeTaxonName(name, match?.rank ?? (rank || undefined))
            ? "italic"
            : "normal",
      }}
    >
      {name || "Unidentified"}
    </Typography>
  );
}

export function PhoneUploadList({
  observations,
  uploadedCount,
  uploading,
  blocked,
  profilePath,
  onCancel,
  onEdit,
  onRetry,
  onRetryAll,
  onRemove,
}: PhoneUploadListProps) {
  const total = uploadedCount + observations.length;
  const fit = (o: BatchObservation) => !isReading(o) && missingFields(o).length === 0;

  if (uploading) {
    return (
      <>
        <Box sx={{ flexShrink: 0, px: 2, pt: 2, pb: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 1 }}>
            <Typography variant="h5" component="h1" sx={{ flex: 1, fontWeight: 700 }}>
              Uploading
            </Typography>
            <Typography sx={{ color: "text.secondary" }}>
              {uploadedCount} of {total} uploaded
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={(uploadedCount / total) * 100}
            aria-label="Upload progress"
          />
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
            Keep this page open. Uploaded observations leave the list.
          </Typography>
        </Box>
        <Box
          component="ul"
          aria-label="Observations"
          sx={{ flex: 1, minHeight: 0, overflowY: "auto", m: 0, px: 2, pb: 2, listStyle: "none" }}
        >
          {observations.map((o) => (
            <Box
              component="li"
              key={o.id}
              data-testid="batch-row"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
                opacity: o.status === "uploading" || o.status === "failed" ? 1 : 0.6,
              }}
            >
              <Thumbnail observation={o} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Name observation={o} />
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {plural(o.photos.length, "photo")}
                </Typography>
              </Box>
              {o.status === "uploading" ? (
                <Typography
                  variant="body2"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    fontWeight: 600,
                    color: "primary.main",
                  }}
                >
                  <CircularProgress size={14} color="inherit" />
                  Uploading
                </Typography>
              ) : o.status === "failed" ? (
                <Typography variant="body2" sx={{ fontWeight: 600, color: "error.main" }}>
                  Failed
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Queued
                </Typography>
              )}
            </Box>
          ))}
        </Box>
        <BottomBar>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<CloseIcon />}
            onClick={onCancel}
            sx={{ minHeight: 48 }}
          >
            Cancel remaining
          </Button>
        </BottomBar>
      </>
    );
  }

  return (
    <>
      <Box sx={{ flexShrink: 0, px: 2, pt: 2, pb: 1.5 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 0.5 }}>
          {plural(observations.length, "observation")} did not upload
        </Typography>
        {uploadedCount > 0 && (
          <Typography sx={{ color: "text.secondary" }}>
            {uploadedCount} uploaded.{" "}
            <MuiLink component={Link} to={profilePath} sx={{ fontWeight: 600 }}>
              View your observations
            </MuiLink>
          </Typography>
        )}
      </Box>
      <Box
        component="section"
        aria-label="Observations"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          px: 2,
          pb: 2,
        }}
      >
        {observations.map((o) => (
          <Paper
            key={o.id}
            variant="outlined"
            data-testid="batch-row"
            sx={{ flexShrink: 0, p: 1.5, borderRadius: 1.5, borderColor: "error.main" }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Thumbnail observation={o} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Name observation={o} />
                <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
                  {[plural(o.photos.length, "photo"), formatBatchDate(o)]
                    .filter(Boolean)
                    .join(", ")}
                </Typography>
              </Box>
              <IconButton onClick={() => onRemove(o)} aria-label="Remove from batch">
                <CloseIcon />
              </IconButton>
            </Box>
            {o.error && (
              <Typography variant="body2" sx={{ color: "error.main", mt: 1 }}>
                {o.error}
              </Typography>
            )}
            <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<EditIcon />}
                onClick={() => onEdit(o.id)}
                sx={{ flex: 1, minHeight: 44 }}
              >
                Edit
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<RefreshIcon />}
                // An edit since the failure may have left it unfit to send.
                disabled={blocked || !fit(o)}
                onClick={() => onRetry(o)}
                sx={{ flex: 1, minHeight: 44 }}
              >
                Retry
              </Button>
            </Box>
          </Paper>
        ))}
      </Box>
      <BottomBar>
        <Button
          variant="contained"
          startIcon={<RefreshIcon />}
          disabled={blocked || !observations.every(fit)}
          onClick={onRetryAll}
          sx={{ minHeight: 48 }}
        >
          Retry all failed
        </Button>
      </BottomBar>
    </>
  );
}
