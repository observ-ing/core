// One observation-to-be in the batch uploader's grid: cover photo, extra photo
// thumbnails, and a summary of what has been filled in. Presentational; the
// page owns selection and the drag-and-drop rules.
import type { DragEvent, MouseEvent, ReactNode } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  CircularProgress,
  Skeleton,
  Typography,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ErrorIcon from "@mui/icons-material/Error";
import RefreshIcon from "@mui/icons-material/Refresh";
import ScheduleIcon from "@mui/icons-material/Schedule";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { coverImageSx } from "../common/layoutSx";
import { isReading, missingFields, type BatchObservation } from "../../lib/batchUpload";
import { formatCoordinate } from "../../lib/utils";
import { setPhotoDragImage } from "./photoDragImage";

/** What dropping the current drag on this card would do. */
export type CardDropState = "none" | "combine" | "add" | "refuse";

export interface BatchCardProps {
  observation: BatchObservation;
  selected: boolean;
  /** Upload in progress: no selecting, dragging, or dropping. */
  locked: boolean;
  dropState: CardDropState;
  /** Photos the card would hold after a combine; shown on the drop overlay. */
  combinedPhotoCount: number;
  /** Where a photo being reordered within this card would land, if anywhere. */
  insertionIndex: number | null;
  /** The photo currently being dragged out of this card, if any. */
  draggingPhotoId: string | null;
  onSelect: (additive: boolean) => void;
  onCardDragStart: (event: DragEvent) => void;
  onPhotoDragStart: (event: DragEvent, photoId: string) => void;
  onDragEnd: () => void;
  /** `insertionIndex` is set when the pointer is over a photo slot of this card. */
  onDragOver: (event: DragEvent, insertionIndex: number | null) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onRetry: () => void;
}

const THUMB_SIZE = 56;

export function formatBatchDate(observation: BatchObservation): string {
  const { date, endDate } = observation;
  if (!date) return "";
  if (endDate) {
    const day = (value: string) =>
      new Date(`${value}T00:00`).toLocaleDateString(undefined, { dateStyle: "medium" });
    return `${day(date.slice(0, 10))} to ${day(endDate)}`;
  }
  return new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Line({ children, warning }: { children: ReactNode; warning?: boolean }) {
  return (
    <Typography
      variant="body2"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        color: warning ? "warning.main" : "text.secondary",
        fontWeight: warning ? 500 : 400,
      }}
    >
      {warning && <WarningAmberIcon sx={{ fontSize: 16 }} />}
      {children}
    </Typography>
  );
}

function InsertionBar() {
  return (
    <Box
      aria-hidden
      sx={{ width: 4, alignSelf: "stretch", borderRadius: 0.5, bgcolor: "primary.main" }}
    />
  );
}

export function BatchCard({
  observation,
  selected,
  locked,
  dropState,
  combinedPhotoCount,
  insertionIndex,
  draggingPhotoId,
  onSelect,
  onCardDragStart,
  onPhotoDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onRetry,
}: BatchCardProps) {
  const theme = useTheme();
  const { photos, taxon, status } = observation;
  const [cover, ...extras] = photos;
  if (!cover) return null;

  const reading = isReading(observation);
  const missing = missingFields(observation);
  const multi = photos.length > 1;
  const failed = status === "failed";
  const busy = reading || status === "uploading";

  const handleClick = (event: MouseEvent) => {
    if (!locked) onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
  };

  // A lone photo drags as its whole card; otherwise the photo drags by itself.
  const photoDragProps = (photoId: string) =>
    multi && !locked
      ? {
          draggable: true,
          onDragStart: (event: DragEvent<HTMLElement>) => {
            event.stopPropagation();
            setPhotoDragImage(
              event,
              event.currentTarget.querySelector("img"),
              theme.palette.primary.dark,
            );
            onPhotoDragStart(event, photoId);
          },
        }
      : {};

  // Insert before a slot when over its left half, after it when over its right.
  const slotDragOver = (index: number) => (event: DragEvent<HTMLElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    onDragOver(event, event.clientX < left + width / 2 ? index : index + 1);
  };

  const borderColor =
    dropState === "refuse" || failed
      ? "error.main"
      : selected || dropState !== "none"
        ? "primary.main"
        : "divider";

  return (
    <Box
      data-testid="batch-card"
      aria-busy={busy}
      draggable={!locked}
      onDragStart={onCardDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(event, null)}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      sx={{
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        borderRadius: 2,
        border: 2,
        borderColor,
        boxShadow: dropState === "none" ? 1 : 4,
        overflow: "hidden",
        cursor: locked ? "default" : "grab",
        opacity: status === "queued" ? 0.7 : 1,
      }}
    >
      <Box sx={{ position: "relative" }}>
        <ButtonBase
          onClick={handleClick}
          onDragOver={slotDragOver(0)}
          aria-label={`Photo ${cover.file.name}`}
          {...photoDragProps(cover.id)}
          sx={{
            display: "block",
            width: "100%",
            aspectRatio: "4 / 3",
            bgcolor: "action.hover",
            opacity: draggingPhotoId === cover.id ? 0.3 : 1,
          }}
        >
          <Box component="img" src={cover.previewUrl} alt="" draggable={false} sx={coverImageSx} />
          <Typography
            variant="caption"
            noWrap
            sx={{
              position: "absolute",
              left: 8,
              bottom: 8,
              maxWidth: "calc(100% - 16px)",
              px: 0.75,
              borderRadius: 0.5,
              bgcolor: "background.paper",
              fontFamily: "monospace",
              opacity: 0.9,
            }}
          >
            {cover.file.name}
          </Typography>
        </ButtonBase>
        {insertionIndex === 0 && (
          <Box sx={{ position: "absolute", inset: 0, right: "auto", display: "flex" }}>
            <InsertionBar />
          </Box>
        )}
        {!locked && (
          <Checkbox
            checked={selected}
            onChange={() => onSelect(true)}
            slotProps={{ input: { "aria-label": "Select observation" } }}
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              color: "common.white",
              filter: "drop-shadow(0 0 2px rgba(0, 0, 0, 0.6))",
            }}
          />
        )}
        {multi && (
          <Typography
            variant="caption"
            sx={{
              position: "absolute",
              top: 10,
              right: 10,
              px: 1,
              borderRadius: 4,
              bgcolor: theme.palette.overlay["modalChip"],
              color: "common.white",
              fontWeight: 600,
            }}
          >
            {photos.length} photos
          </Typography>
        )}
        {busy && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(0, 0, 0, 0.4)",
              pointerEvents: "none",
            }}
          >
            <CircularProgress size={32} sx={{ color: "common.white" }} />
          </Box>
        )}
        {dropState !== "none" && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.5,
              p: 1.5,
              textAlign: "center",
              color: "common.white",
              bgcolor: dropState === "refuse" ? "error.dark" : "primary.dark",
              opacity: 0.9,
              pointerEvents: "none",
            }}
          >
            {dropState === "refuse" ? <ErrorIcon /> : <AddIcon />}
            <Typography sx={{ fontWeight: 600 }}>
              {dropState === "refuse"
                ? "Can't combine"
                : dropState === "add"
                  ? "Add photos"
                  : "Combine"}
            </Typography>
            <Typography variant="body2">
              {dropState === "refuse"
                ? "An observation holds up to 10 photos"
                : `${combinedPhotoCount} photos, 1 observation`}
            </Typography>
          </Box>
        )}
      </Box>

      {multi && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, px: 0.75, pt: 0.75 }}>
          {extras.map((photo, i) => (
            <Box key={photo.id} sx={{ display: "flex", gap: 0.75 }}>
              {insertionIndex === i + 1 && <InsertionBar />}
              <ButtonBase
                onClick={handleClick}
                onDragOver={slotDragOver(i + 1)}
                aria-label={`Photo ${photo.file.name}`}
                title={photo.file.name}
                {...photoDragProps(photo.id)}
                sx={{
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  borderRadius: 1,
                  overflow: "hidden",
                  bgcolor: "action.hover",
                  opacity: draggingPhotoId === photo.id ? 0.3 : 1,
                }}
              >
                <Box
                  component="img"
                  src={photo.previewUrl}
                  alt=""
                  draggable={false}
                  sx={coverImageSx}
                />
              </ButtonBase>
            </Box>
          ))}
          {insertionIndex === photos.length && <InsertionBar />}
        </Box>
      )}

      <ButtonBase
        onClick={handleClick}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 0.5,
          p: 1.5,
          textAlign: "left",
        }}
      >
        {reading ? (
          <>
            <Typography sx={{ fontWeight: 600, color: "text.secondary" }}>Reading photo</Typography>
            <Skeleton width="70%" />
            <Skeleton width="55%" />
          </>
        ) : (
          <>
            <Typography
              noWrap
              sx={{
                fontWeight: 600,
                fontStyle: taxon.name ? "italic" : "normal",
                color: taxon.name ? "text.primary" : "text.secondary",
              }}
            >
              {taxon.name || "No identification"}
            </Typography>
            {missing.includes("kingdom") && <Line warning>Missing kingdom</Line>}
            {observation.date ? (
              <Line warning={missing.includes("endDate")}>
                {missing.includes("endDate")
                  ? "End date before start"
                  : formatBatchDate(observation)}
              </Line>
            ) : (
              <Line warning>Missing date</Line>
            )}
            {observation.latitude !== null && observation.longitude !== null ? (
              <Line>
                {formatCoordinate(observation.latitude)}, {formatCoordinate(observation.longitude)}
              </Line>
            ) : (
              <Line warning>Missing location</Line>
            )}
            {observation.remarks && (
              <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
                {observation.remarks}
              </Typography>
            )}
          </>
        )}
        {status === "queued" && (
          <Typography
            variant="body2"
            sx={{ display: "flex", alignItems: "center", gap: 0.5, fontWeight: 600 }}
          >
            <ScheduleIcon sx={{ fontSize: 16 }} />
            Queued
          </Typography>
        )}
        {status === "uploading" && (
          <Typography variant="body2" sx={{ fontWeight: 600, color: "primary.main" }}>
            Uploading
          </Typography>
        )}
        {failed && (
          <>
            <Typography
              variant="body2"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                fontWeight: 600,
                color: "error.main",
              }}
            >
              <ErrorIcon sx={{ fontSize: 16 }} />
              Upload failed
            </Typography>
            {observation.error && (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {observation.error}
              </Typography>
            )}
          </>
        )}
      </ButtonBase>
      {failed && !locked && (
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={<RefreshIcon />}
          onClick={onRetry}
          sx={{ mx: 1.5, mb: 1.5 }}
        >
          Retry
        </Button>
      )}
    </Box>
  );
}
