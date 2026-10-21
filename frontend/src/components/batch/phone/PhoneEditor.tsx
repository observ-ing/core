// Phone layout, editing: one observation, or several at once, as a list of
// fields that each open a full-screen step of their own. With one observation
// the header steps through the batch.
import type { ReactNode } from "react";
import { Box, Button, ButtonBase, IconButton, Paper, Typography } from "@mui/material";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import CheckIcon from "@mui/icons-material/Check";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import NotesIcon from "@mui/icons-material/Notes";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import PlaceIcon from "@mui/icons-material/Place";
import SearchIcon from "@mui/icons-material/Search";
import { coverImageSx, overlayBadgeSx } from "../../common/layoutSx";
import { shouldItalicizeTaxonName } from "../../common/TaxonLink";
import {
  describeMissing,
  hasLocation,
  isReading,
  missingFields,
  type BatchObservation,
} from "../../../lib/batchUpload";
import { browserUtcOffset } from "../../../lib/observationInput";
import { formatCoordinate } from "../../../lib/utils";
import { formatBatchDate } from "../BatchCard";
import { shared } from "../BatchEditor";
import { PhoneStep } from "./PhoneStep";

/** The full-screen steps a field of the editor opens. */
export type EditStep = "taxon" | "date" | "location" | "remarks" | "photos";

export interface PhoneEditorProps {
  /** Every observation still to be sent, in batch order. */
  observations: BatchObservation[];
  /** The ones being edited: one, or several to change together. Never empty. */
  editing: BatchObservation[];
  /** The next observation that can't be uploaded yet, and how many there are besides this one. */
  nextIncomplete: { id: string; left: number } | null;
  onBack: () => void;
  onStep: (step: EditStep) => void;
  /** Edit another observation in place of this one. */
  onGo: (id: string) => void;
  onRemove: () => void;
}

function Row({
  icon,
  label,
  value,
  detail,
  warns = false,
  muted = false,
  italic = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string | undefined;
  /** The value says something is missing. */
  warns?: boolean;
  /** The value is a prompt, not something entered. */
  muted?: boolean;
  italic?: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        minHeight: 64,
        pl: 2,
        pr: 1.5,
        py: 1.25,
        textAlign: "left",
        color: warns ? "warning.main" : "text.secondary",
        "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" },
      }}
    >
      {icon}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>{label}</Typography>
        <Typography
          noWrap
          sx={{
            fontWeight: muted ? 400 : 600,
            fontStyle: italic ? "italic" : "normal",
            color: warns ? "warning.main" : muted ? "text.secondary" : "text.primary",
          }}
        >
          {value}
        </Typography>
        {detail && (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {detail}
          </Typography>
        )}
      </Box>
      <ChevronRightIcon sx={{ color: "text.secondary" }} />
    </ButtonBase>
  );
}

export function PhoneEditor({
  observations,
  editing,
  nextIncomplete,
  onBack,
  onStep,
  onGo,
  onRemove,
}: PhoneEditorProps) {
  const [first] = editing;
  if (!first) return null;
  const count = editing.length;
  const single = count === 1;
  const all = single ? "" : ` for all ${count}`;

  // Identification
  const name = shared(editing.map((o) => o.taxon.name.trim()));
  const identified = editing.filter((o) => o.taxon.name.trim()).length;
  const needsKingdom = editing.some((o) => missingFields(o).includes("kingdom"));
  const rank = first.taxon.match?.rank ?? (first.taxon.rank || undefined);

  // Date
  const date = shared(editing.map((o) => o.date));
  const undated = editing.filter((o) => !o.date).length;
  const fromPhoto = single && first.photos.some((p) => p.exif?.date === first.date);
  // `null` is a real value here (the browser's zone), so "mixed" needs its own test.
  const zoneMixed = new Set(editing.map((o) => o.utcOffset)).size > 1;
  const zone = zoneMixed
    ? "Different time zones"
    : first.utcOffset
      ? `UTC${first.utcOffset}`
      : `Local time, UTC${browserUtcOffset(date ?? "")}`;

  // A photo still being read may yet carry the date or location, so neither is
  // reported missing until it has been.
  const reading = single && isReading(first);

  // Location
  const located = editing.filter(hasLocation);
  const position = shared(editing.map((o) => `${o.latitude},${o.longitude}`));
  const sameLocation = located.length === count && position !== undefined;

  const remarks = shared(editing.map((o) => o.remarks));

  const index = observations.findIndex((o) => o.id === first.id);
  const previous = observations[index - 1];
  const next = observations[index + 1];
  const missing = single && !reading ? missingFields(first) : [];
  const stepButtonSx = { border: 1, borderColor: "divider", borderRadius: 1 };

  return (
    <PhoneStep
      title={
        single
          ? `Observation ${index + 1} of ${observations.length}`
          : `Editing ${count} observations`
      }
      subtitle={
        single
          ? missing.length > 0
            ? describeMissing(missing)
            : undefined
          : `A change here applies to all ${count}.`
      }
      subtitleWarns={single}
      backLabel="Back to batch"
      onBack={onBack}
      actions={
        single && (
          <>
            <IconButton
              color="inherit"
              aria-label="Previous observation"
              disabled={!previous}
              onClick={() => previous && onGo(previous.id)}
              sx={stepButtonSx}
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              color="inherit"
              aria-label="Next observation"
              disabled={!next}
              onClick={() => next && onGo(next.id)}
              sx={stepButtonSx}
            >
              <ChevronRightIcon />
            </IconButton>
          </>
        )
      }
      footer={
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <Button
            variant={nextIncomplete ? "outlined" : "contained"}
            color={nextIncomplete ? "inherit" : "primary"}
            startIcon={<CheckIcon />}
            onClick={onBack}
            sx={{ flex: 1, minHeight: 48 }}
          >
            Done
          </Button>
          {nextIncomplete && (
            <Button
              variant="contained"
              endIcon={<ChevronRightIcon />}
              onClick={() => onGo(nextIncomplete.id)}
              sx={{ flex: 2, minHeight: 48 }}
            >
              Next ({nextIncomplete.left} left)
            </Button>
          )}
        </Box>
      }
    >
      {single ? (
        <Box sx={{ display: "flex", gap: 1, height: 150, flexShrink: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0, borderRadius: 1.25, overflow: "hidden" }}>
            <Box component="img" src={first.photos[0]?.previewUrl} alt="" sx={coverImageSx} />
          </Box>
          <Box sx={{ width: 96, display: "flex", flexDirection: "column", gap: 1 }}>
            {first.photos[1] && (
              <Box sx={{ flex: 1, minHeight: 0, borderRadius: 1, overflow: "hidden" }}>
                <Box component="img" src={first.photos[1].previewUrl} alt="" sx={coverImageSx} />
              </Box>
            )}
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => onStep("photos")}
              sx={{ flex: 1, flexDirection: "column", gap: 0.25, lineHeight: 1.2 }}
            >
              <PhotoLibraryIcon fontSize="small" />
              Manage {first.photos.length}
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: "flex", gap: 1, overflowX: "auto", flexShrink: 0 }}>
          {editing.map((o) => (
            <Box
              key={o.id}
              sx={{
                position: "relative",
                width: 84,
                height: 84,
                flexShrink: 0,
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <Box component="img" src={o.photos[0]?.previewUrl} alt="" sx={coverImageSx} />
              {o.photos.length > 1 && (
                <Typography
                  variant="caption"
                  sx={{
                    position: "absolute",
                    right: 4,
                    bottom: 4,
                    px: 0.75,
                    ...overlayBadgeSx,
                  }}
                >
                  {o.photos.length}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Paper
        variant="outlined"
        sx={{ display: "flex", flexDirection: "column", borderRadius: 1.5, overflow: "hidden" }}
      >
        <Row
          icon={<SearchIcon />}
          label="Identification"
          value={name === undefined ? "Mixed" : name || "Unidentified"}
          detail={
            name === undefined
              ? `${identified} identified, ${count - identified} unidentified. ` +
                "Choosing one replaces all."
              : needsKingdom
                ? "Not in the taxonomy. Choose a kingdom."
                : single
                  ? first.taxon.match?.commonName
                  : undefined
          }
          warns={needsKingdom}
          muted={name === ""}
          italic={!!name && shouldItalicizeTaxonName(name, rank)}
          onClick={() => onStep("taxon")}
        />
        <Row
          icon={<CalendarTodayIcon />}
          label="Date and time"
          value={
            date === undefined
              ? "Different dates"
              : date
                ? formatBatchDate(first)
                : reading
                  ? "Reading photo"
                  : "Required"
          }
          detail={
            date
              ? zone + (fromPhoto ? ", from the photo" : "")
              : reading
                ? undefined
                : single
                  ? "The photos have no capture date."
                  : undated > 0
                    ? `${undated} ${undated === 1 ? "has" : "have"} no date`
                    : undefined
          }
          warns={(date === "" && !reading) || missing.includes("endDate")}
          muted={date === "" && reading}
          onClick={() => onStep("date")}
        />
        <Row
          icon={<PlaceIcon />}
          label="Location"
          value={
            sameLocation && first.latitude !== null && first.longitude !== null
              ? `${formatCoordinate(first.latitude)}, ${formatCoordinate(first.longitude)}`
              : located.length === 0
                ? reading
                  ? "Reading photo"
                  : "Required"
                : "Different locations"
          }
          detail={
            single
              ? hasLocation(first)
                ? `Within ${first.uncertaintyMeters} m`
                : reading
                  ? undefined
                  : "The photos have no GPS position."
              : `Open the map to set one${all}.`
          }
          warns={located.length === 0 && !reading}
          muted={located.length === 0 && reading}
          onClick={() => onStep("location")}
        />
        <Row
          icon={<NotesIcon />}
          label="Remarks"
          value={
            remarks === undefined ? "Mixed" : remarks || `Add remarks${all && ` to all ${count}`}`
          }
          muted={remarks === ""}
          onClick={() => onStep("remarks")}
        />
      </Paper>

      {single ? (
        <Button
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={onRemove}
          sx={{ alignSelf: "flex-start", minHeight: 44 }}
        >
          Remove from batch
        </Button>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Photos are managed one observation at a time. To put these {count} in one observation, go
          back and tap Combine.
        </Typography>
      )}
    </PhoneStep>
  );
}
