// Phone layout, reviewing the batch: two columns of cards under the app's top
// bar. Tapping a card edits it and its checkbox selects it; with anything
// checked, the bars at the top and bottom turn to acting on the selection.
import {
  AppBar,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  Skeleton,
  Toolbar,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AppsIcon from "@mui/icons-material/Apps";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import CloseIcon from "@mui/icons-material/Close";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import ErrorIcon from "@mui/icons-material/Error";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { coverImageSx, miniIconSx, overlayBadgeSx } from "../../common/layoutSx";
import { shouldItalicizeTaxonName } from "../../common/TaxonLink";
import {
  canCombine,
  describeMissing,
  isReading,
  missingFields,
  type BatchObservation,
} from "../../../lib/batchUpload";
import { plural } from "../../../lib/utils";
import { SelectionBox, formatBatchDate } from "../BatchCard";
import { BottomBar, StackedAction } from "./PhoneStep";

export interface PhoneGridProps {
  /** Every observation still to be sent, in batch order. */
  observations: BatchObservation[];
  selected: string[];
  onlyIncomplete: boolean;
  onFilter: (onlyIncomplete: boolean) => void;
  /** HEIC photos still being converted. */
  converting: number;
  /** Upload can't start yet, for a reason the cards don't show (e.g. photos still converting). */
  blocked: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
  onAddPhotos: () => void;
  onUpload: () => void;
  onEditSelected: () => void;
  onCombine: () => void;
  onSplit: () => void;
  onRemoveSelected: () => void;
}

function PhoneCard({
  observation,
  checked,
  onOpen,
  onToggle,
}: {
  observation: BatchObservation;
  checked: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { photos, taxon } = observation;
  const [cover] = photos;
  if (!cover) return null;
  const reading = isReading(observation);
  const missing = reading ? [] : missingFields(observation);
  const failed = observation.status === "failed";
  const italic =
    !!taxon.name &&
    shouldItalicizeTaxonName(taxon.name, taxon.match?.rank ?? (taxon.rank || undefined));

  return (
    <Box
      data-testid="batch-card"
      aria-busy={reading}
      // A long press is only a press here, so the system's menu for the photo
      // stays out of the way.
      onContextMenu={(event) => event.preventDefault()}
      sx={{
        userSelect: "none",
        WebkitTouchCallout: "none",
        position: "relative",
        minWidth: 0,
        bgcolor: "background.paper",
        borderRadius: 1.25,
        border: 1,
        borderColor: failed ? "error.main" : "divider",
        outline: checked ? 3 : 0,
        outlineStyle: "solid",
        outlineColor: "primary.main",
        outlineOffset: -1,
        overflow: "hidden",
      }}
    >
      <ButtonBase
        onClick={onOpen}
        aria-label={`Edit ${taxon.name || "unidentified observation"}`}
        sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%" }}
      >
        <Box sx={{ position: "relative", aspectRatio: "4 / 3", bgcolor: "action.hover" }}>
          <Box component="img" src={cover.previewUrl} alt="" draggable={false} sx={coverImageSx} />
          {photos.length > 1 && (
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                top: 8,
                right: 8,
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                ...overlayBadgeSx,
              }}
            >
              <PhotoLibraryIcon sx={miniIconSx} />
              {photos.length}
            </Typography>
          )}
          {reading && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: (theme) => theme.palette.overlay["chip"],
              }}
            >
              <CircularProgress size={28} sx={{ color: "common.white" }} />
            </Box>
          )}
        </Box>
        <Box sx={{ px: 1.25, pt: 1, pb: 1.25, textAlign: "left", minWidth: 0 }}>
          {reading ? (
            <>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Reading photo
              </Typography>
              <Skeleton width="70%" />
            </>
          ) : (
            <>
              <Typography
                variant="body2"
                noWrap
                sx={{
                  fontWeight: taxon.name ? 600 : 400,
                  fontStyle: italic ? "italic" : "normal",
                  color: taxon.name ? "text.primary" : "text.secondary",
                }}
              >
                {taxon.name || "Unidentified"}
              </Typography>
              {observation.date && (
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ display: "block", color: "text.secondary" }}
                >
                  {formatBatchDate(observation)}
                </Typography>
              )}
              {missing.length > 0 && (
                <Typography
                  variant="caption"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    fontWeight: 600,
                    color: "warning.main",
                  }}
                >
                  <WarningAmberIcon sx={miniIconSx} />
                  {describeMissing(missing)}
                </Typography>
              )}
              {failed && (
                <Typography
                  variant="caption"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    fontWeight: 600,
                    color: "error.main",
                  }}
                >
                  <ErrorIcon sx={miniIconSx} />
                  Upload failed
                </Typography>
              )}
            </>
          )}
        </Box>
      </ButtonBase>
      <Checkbox
        checked={checked}
        onChange={onToggle}
        slotProps={{ input: { "aria-label": "Select observation" } }}
        icon={<SelectionBox checked={false} size={28} />}
        checkedIcon={<SelectionBox checked size={28} />}
        sx={{ position: "absolute", top: 0, left: 0 }}
      />
    </Box>
  );
}

export function PhoneGrid({
  observations,
  selected,
  onlyIncomplete,
  onFilter,
  converting,
  blocked,
  onOpen,
  onToggle,
  onSelectAll,
  onClearSelection,
  onAddPhotos,
  onUpload,
  onEditSelected,
  onCombine,
  onSplit,
  onRemoveSelected,
}: PhoneGridProps) {
  const incomplete = observations.filter((o) => !isReading(o) && missingFields(o).length > 0);
  // The filter lapses once nothing is incomplete, so the grid never empties itself.
  const filtering = onlyIncomplete && incomplete.length > 0;
  // A checked card stays in view once it is complete: what the bar acts on can be seen.
  const shown = filtering
    ? observations.filter((o) => incomplete.includes(o) || selected.includes(o.id))
    : observations;
  const picked = observations.filter((o) => selected.includes(o.id));
  const pickedPhotos = picked.reduce((count, o) => count + o.photos.length, 0);
  const selecting = picked.length > 0;
  const onlyDateOrLocation = incomplete.every((o) =>
    missingFields(o).every((field) => field === "date" || field === "location"),
  );

  return (
    <>
      {selecting && (
        // Takes the place of the app's top bar while anything is checked.
        <AppBar
          position="fixed"
          elevation={0}
          sx={{ bgcolor: "primary.dark", zIndex: (theme) => theme.zIndex.drawer + 2 }}
        >
          <Toolbar sx={{ minHeight: 64, gap: 0.5, px: 1 }}>
            <IconButton color="inherit" onClick={onClearSelection} aria-label="Clear selection">
              <CloseIcon />
            </IconButton>
            <Typography role="status" sx={{ flex: 1, fontWeight: 700, fontSize: 18 }}>
              {picked.length} selected
            </Typography>
            <Button
              color="inherit"
              startIcon={<SelectAllIcon />}
              onClick={() => onSelectAll(shown.map((o) => o.id))}
              sx={{ minHeight: 44 }}
            >
              Select all
            </Button>
          </Toolbar>
        </AppBar>
      )}

      <Box sx={{ flexShrink: 0, px: 2, pt: 2, pb: 1.5 }}>
        {selecting ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Check more to add them. {plural(pickedPhotos, "photo")} in the selection.
          </Typography>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 1.5 }}>
              <Typography variant="h5" component="h1" sx={{ flex: 1, fontWeight: 700 }}>
                Batch upload
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Tap to edit, check to select
              </Typography>
            </Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
              <Chip
                icon={<AppsIcon />}
                label={`All ${observations.length}`}
                onClick={() => onFilter(false)}
                aria-pressed={!filtering}
                color={filtering ? "default" : "primary"}
                variant={filtering ? "outlined" : "filled"}
                sx={{ height: 40, borderRadius: 5, px: 0.5, fontWeight: 600 }}
              />
              {incomplete.length > 0 && (
                <Chip
                  icon={<WarningAmberIcon />}
                  label={`Incomplete ${incomplete.length}`}
                  onClick={() => onFilter(true)}
                  aria-pressed={filtering}
                  color="warning"
                  variant={filtering ? "filled" : "outlined"}
                  sx={{ height: 40, borderRadius: 5, px: 0.5, fontWeight: 600 }}
                />
              )}
              {converting > 0 && (
                <Typography
                  role="status"
                  variant="body2"
                  sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}
                >
                  <CircularProgress size={14} color="inherit" />
                  Converting {plural(converting, "HEIC photo")}…
                </Typography>
              )}
            </Box>
          </>
        )}
      </Box>

      <Box
        component="section"
        aria-label="Observations"
        sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2, pb: 2 }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>
          {shown.map((observation) => (
            <PhoneCard
              key={observation.id}
              observation={observation}
              checked={selected.includes(observation.id)}
              onOpen={() => onOpen(observation.id)}
              onToggle={() => onToggle(observation.id)}
            />
          ))}
        </Box>
      </Box>

      {selecting ? (
        <BottomBar>
          <Box sx={{ display: "flex", gap: 0.5, mx: -1 }}>
            <StackedAction startIcon={<EditIcon />} onClick={onEditSelected}>
              Edit
            </StackedAction>
            <StackedAction
              startIcon={<CallMergeIcon />}
              disabled={!canCombine(picked)}
              onClick={onCombine}
              color="primary"
              variant={canCombine(picked) ? "contained" : "text"}
            >
              Combine
            </StackedAction>
            <StackedAction
              startIcon={<CallSplitIcon />}
              disabled={!picked.some((o) => o.photos.length > 1)}
              onClick={onSplit}
            >
              Split photos
            </StackedAction>
            <StackedAction
              startIcon={<DeleteOutlineIcon />}
              color="error"
              onClick={onRemoveSelected}
            >
              Remove
            </StackedAction>
          </Box>
        </BottomBar>
      ) : (
        <BottomBar>
          {incomplete.length > 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
              {plural(incomplete.length, "observation")}{" "}
              {incomplete.length === 1 ? "needs" : "need"}{" "}
              {onlyDateOrLocation ? "a date or location" : "fixing"} before upload.
            </Typography>
          )}
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<AddIcon />}
              onClick={onAddPhotos}
              sx={{ minHeight: 48 }}
            >
              Add photos
            </Button>
            <Button
              variant="contained"
              startIcon={<CloudUploadIcon />}
              disabled={blocked || incomplete.length > 0 || observations.some(isReading)}
              onClick={onUpload}
              sx={{ flex: 1, minHeight: 48 }}
            >
              Upload {observations.length}
            </Button>
          </Box>
        </BottomBar>
      )}
    </>
  );
}
