// Phone layout, the photos of one observation: tap to select, then move, split
// off or remove; touch and hold, then drag, to reorder or to drop a photo on one
// of the two targets the bottom bar turns into. Native drag events only (#887).
import { useState, type DragEvent, type ReactNode } from "react";
import { Box, Button, ButtonBase, Paper, Typography, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import CheckIcon from "@mui/icons-material/Check";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import UndoIcon from "@mui/icons-material/Undo";
import {
  cardRadius,
  coverImageSx,
  panelRadius,
  thumbnailFrameSx,
  touchTarget,
} from "../../common/layoutSx";
import { isReading, type BatchObservation } from "../../../lib/batchUpload";
import { MAX_IMAGES } from "../../../lib/imageSelection";
import { plural } from "../../../lib/utils";
import { SelectionBox } from "../BatchCard";
import { setPhotoDragImage } from "../photoDragImage";
import { PhoneStep, StackedAction } from "./PhoneStep";

/** What the bar confirming a split or a removal says, until it is dismissed. */
export interface PhotoNotice {
  title: string;
  detail?: string | undefined;
  /** Preview of the photo that left, or the first of several. */
  thumbnailUrl: string;
  /** Offered after a split into a single new observation: goes and edits it. */
  onEdit?: (() => void) | undefined;
}

export interface PhonePhotosProps {
  observation: BatchObservation;
  notice: PhotoNotice | null;
  /** A long press can start a drag; when it can't, the hint leaves it out. */
  touchDrag?: boolean;
  onBack: () => void;
  onAdd: () => void;
  /** `index` is where the photo lands among the others, once it has been lifted out. */
  onReorder: (photoId: string, index: number) => void;
  onSplit: (photoIds: string[]) => void;
  onRemove: (photoIds: string[]) => void;
  onUndo: () => void;
  /** Called for OK, and for anything else done on the screen, which keeps the change. */
  onDismissNotice: () => void;
}

type Target = "split" | "remove";

const TILE_HEIGHT = 114;

function DropTarget({
  active,
  disabled = false,
  danger = false,
  icon,
  children,
  onOver,
  onLeave,
  onDrop,
}: {
  active: boolean;
  disabled?: boolean;
  danger?: boolean;
  icon: ReactNode;
  children: ReactNode;
  onOver: () => void;
  onLeave: () => void;
  onDrop: () => void;
}) {
  const color = danger ? "error.main" : "primary.main";
  return (
    <Box
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        onOver();
      }}
      onDragLeave={onLeave}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        onDrop();
      }}
      sx={{
        flex: 1,
        height: 76,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.5,
        border: 2,
        borderStyle: active ? "solid" : "dashed",
        borderColor: danger || active ? color : "text.secondary",
        borderRadius: cardRadius,
        bgcolor: active ? color : "background.paper",
        color: active ? "common.white" : danger ? "error.main" : "text.primary",
        fontSize: 14,
        fontWeight: 600,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
      {children}
    </Box>
  );
}

export function PhonePhotos({
  observation,
  notice,
  touchDrag = true,
  onBack,
  onAdd,
  onReorder,
  onSplit,
  onRemove,
  onUndo,
  onDismissNotice,
}: PhonePhotosProps) {
  const theme = useTheme();
  const { photos } = observation;
  const [checked, setChecked] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Slot the dragged photo would be put in front of; `photos.length` for the end. */
  const [insertion, setInsertion] = useState<number | null>(null);
  const [over, setOver] = useState<Target | null>(null);

  // A photo checked and then split off or removed is no longer here to act on.
  const picked = checked.filter((id) => photos.some((p) => p.id === id));
  // Undo puts back what the screen held, which it can't while a file is still
  // being read into it.
  const reading = isReading(observation);
  const lone = photos.length === 1;

  // Without a drag (keyboard, or a browser that can't drag by touch) one checked
  // photo moves a place at a time, and stays checked to move again.
  const [moving] = picked.length === 1 ? picked : [];
  const movingIndex = photos.findIndex((p) => p.id === moving);
  const move = (by: number) => {
    if (moving) onReorder(moving, movingIndex + by);
  };

  const act = (action: (ids: string[]) => void, ids: string[]) => {
    setChecked([]);
    action(ids);
  };

  const endDrag = () => {
    // Deferred so it lands after the dragstart timer that sets `dragging`: a
    // drag cancelled at once ends before that timer fires.
    setTimeout(() => {
      setDragging(null);
      setInsertion(null);
      setOver(null);
    }, 0);
  };

  const handleDragStart = (event: DragEvent<HTMLElement>, photoId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", photoId);
    setPhotoDragImage(event, event.currentTarget.querySelector("img"), theme.palette.primary.dark);
    // Deferred: re-rendering the source during dragstart can cancel the drag.
    setTimeout(() => {
      onDismissNotice();
      setDragging(photoId);
    }, 0);
  };

  // Insert before a tile when over its left half, after it when over its right.
  const handleTileDragOver = (event: DragEvent<HTMLElement>, index: number) => {
    if (!dragging) return;
    event.preventDefault();
    const { left, width } = event.currentTarget.getBoundingClientRect();
    setInsertion(event.clientX < left + width / 2 ? index : index + 1);
    setOver(null);
  };

  const handleGridDrop = (event: DragEvent) => {
    event.preventDefault();
    const from = photos.findIndex((p) => p.id === dragging);
    if (dragging && insertion !== null && from !== -1) {
      // The slot counts the dragged photo, which is about to move.
      onReorder(dragging, insertion > from ? insertion - 1 : insertion);
    }
    endDrag();
  };

  const dropOn = (action: (ids: string[]) => void) => () => {
    if (dragging) act(action, [dragging]);
    endDrag();
  };

  const bar = (side: "left" | "right") => (
    <Box
      aria-hidden
      data-testid="photo-insertion-bar"
      sx={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side]: -6,
        width: 4,
        borderRadius: 0.5,
        bgcolor: "primary.main",
      }}
    />
  );

  const footer = dragging ? (
    <>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {over === "split"
          ? "Release to make a new observation from this photo."
          : over === "remove"
            ? "Release to remove this photo."
            : "Drop at the green bar to reorder, or on a target below."}
      </Typography>
      <Box sx={{ display: "flex", gap: 1 }}>
        <DropTarget
          active={over === "split"}
          disabled={lone || reading}
          icon={<CallSplitIcon />}
          onOver={() => {
            setOver("split");
            setInsertion(null);
          }}
          onLeave={() => setOver(null)}
          onDrop={dropOn(onSplit)}
        >
          Split off
        </DropTarget>
        <DropTarget
          active={over === "remove"}
          disabled={reading}
          danger
          icon={<DeleteOutlineIcon />}
          onOver={() => {
            setOver("remove");
            setInsertion(null);
          }}
          onLeave={() => setOver(null)}
          onDrop={dropOn(onRemove)}
        >
          Remove
        </DropTarget>
      </Box>
    </>
  ) : notice ? (
    <>
      <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box sx={{ width: 44, height: 44, flexShrink: 0, ...thumbnailFrameSx }}>
          <Box component="img" src={notice.thumbnailUrl} alt="" sx={coverImageSx} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }}>{notice.title}</Typography>
          {notice.detail && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {notice.detail}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<UndoIcon />}
          onClick={onUndo}
          sx={{ flex: 1, minHeight: touchTarget }}
        >
          Undo
        </Button>
        {notice.onEdit && (
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<EditIcon />}
            onClick={notice.onEdit}
            sx={{ flex: 1, minHeight: touchTarget }}
          >
            Edit it
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={<CheckIcon />}
          onClick={onDismissNotice}
          sx={{ flex: 1, minHeight: touchTarget }}
        >
          OK
        </Button>
      </Box>
    </>
  ) : picked.length > 0 ? (
    <>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {plural(picked.length, "photo")} selected
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, mx: -1 }}>
        <StackedAction
          startIcon={<ArrowBackIcon />}
          disabled={!moving || movingIndex === 0}
          onClick={() => move(-1)}
        >
          Move earlier
        </StackedAction>
        <StackedAction
          startIcon={<ArrowForwardIcon />}
          disabled={!moving || movingIndex === photos.length - 1}
          onClick={() => move(1)}
        >
          Move later
        </StackedAction>
        <StackedAction
          startIcon={<CallSplitIcon />}
          disabled={lone || reading}
          onClick={() => act(onSplit, picked)}
        >
          Split off
        </StackedAction>
        <StackedAction
          startIcon={<DeleteOutlineIcon />}
          color="error"
          disabled={reading}
          onClick={() => act(onRemove, picked)}
        >
          Remove
        </StackedAction>
      </Box>
    </>
  ) : undefined;

  return (
    <PhoneStep
      title="Photos"
      footer={footer}
      subtitle={`${photos.length} of ${MAX_IMAGES} in this observation`}
      backLabel="Back to observation"
      onBack={onBack}
    >
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {touchDrag
          ? "Touch and hold a photo, then drag it to reorder. Tap to select."
          : "Tap a photo to select it."}
      </Typography>
      <Box
        onDragOver={(event) => {
          // Between tiles the pointer is over the grid but no tile; keep the bar.
          if (dragging) event.preventDefault();
        }}
        onDrop={handleGridDrop}
        sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}
      >
        {photos.map((photo, i) => {
          const isChecked = picked.includes(photo.id);
          return (
            <Box key={photo.id} sx={{ position: "relative" }}>
              <ButtonBase
                draggable
                onDragStart={(event) => handleDragStart(event, photo.id)}
                onDragEnd={endDrag}
                onDragOver={(event) => handleTileDragOver(event, i)}
                // This is an editing surface: a long press starts a drag, so the
                // system's menu for the image stays out of the way.
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  onDismissNotice();
                  setChecked(
                    isChecked ? picked.filter((id) => id !== photo.id) : [...picked, photo.id],
                  );
                }}
                aria-pressed={isChecked}
                aria-label={`Photo ${i + 1}`}
                sx={{
                  display: "block",
                  width: "100%",
                  height: TILE_HEIGHT,
                  borderRadius: 1,
                  overflow: "hidden",
                  bgcolor: "action.hover",
                  opacity: dragging === photo.id ? 0.35 : 1,
                  outline: isChecked ? 3 : 0,
                  outlineStyle: "solid",
                  outlineColor: "primary.main",
                  outlineOffset: 2,
                  userSelect: "none",
                  WebkitTouchCallout: "none",
                }}
              >
                <Box
                  component="img"
                  src={photo.previewUrl}
                  alt=""
                  draggable={false}
                  sx={[coverImageSx, { pointerEvents: "none" }]}
                />
                <Box sx={{ position: "absolute", top: 6, left: 6 }}>
                  <SelectionBox checked={isChecked} size={28} />
                </Box>
                {/* In an even grid nothing else shows the order. */}
                <Typography
                  variant="caption"
                  sx={{
                    position: "absolute",
                    left: 6,
                    bottom: 6,
                    minWidth: 24,
                    px: 0.75,
                    borderRadius: 3,
                    bgcolor: theme.palette.overlay["modalChip"],
                    color: "common.white",
                    fontFamily: "monospace",
                    fontWeight: 600,
                  }}
                >
                  {i + 1}
                </Typography>
              </ButtonBase>
              {dragging && insertion === i && bar("left")}
              {dragging && insertion === photos.length && i === photos.length - 1 && bar("right")}
            </Box>
          );
        })}
        {photos.length < MAX_IMAGES && (
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => {
              onDismissNotice();
              onAdd();
            }}
            sx={{
              height: TILE_HEIGHT,
              flexDirection: "column",
              gap: 0.5,
              border: 2,
              borderStyle: "dashed",
              borderColor: "text.secondary",
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
          >
            <AddIcon />
            Add
          </Button>
        )}
      </Box>
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          gap: 1.5,
          p: 1.75,
          borderRadius: panelRadius,
          color: "text.secondary",
        }}
      >
        <CallSplitIcon fontSize="small" />
        <Typography variant="body2">
          Splitting off makes a new observation from each selected photo, with that photo's own date
          and location.
        </Typography>
      </Paper>
    </PhoneStep>
  );
}
