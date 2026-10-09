// Desktop batch uploader (#884): drop many photos, group them into
// observations by dragging, edit one or many at a time, then upload them all.
// The state rules live in lib/batchUpload; this file wires them to the grid,
// the drag-and-drop gestures, and the upload queue.
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link, useBlocker, useNavigate } from "react-router-dom";
import {
  alpha,
  Box,
  Button,
  LinearProgress,
  Link as MuiLink,
  Typography,
  useTheme,
} from "@mui/material";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DeselectIcon from "@mui/icons-material/Deselect";
import ErrorIcon from "@mui/icons-material/Error";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import RefreshIcon from "@mui/icons-material/Refresh";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useAppDispatch, useAppSelector } from "../../store";
import { trackSubmission } from "../../store/pendingSlice";
import { submitObservation } from "../../services/api";
import { makeTombstoneOccurrence, prependOccurrence } from "../../lib/query/occurrenceCache";
import { useUserPreferences } from "../../lib/query/hooks";
import { useToast } from "../../hooks/useToast";
import { usePageTitle } from "../../hooks/usePageTitle";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { EmptyState } from "../common/EmptyState";
import {
  MAX_BATCH_PHOTOS,
  batchReducer,
  canCombine,
  initialBatchState,
  isReading,
  missingFields,
  runPool,
  toEventDate,
  toObservationInput,
  vetBatchFiles,
  type BatchObservation,
  type BatchPhoto,
  type SkippedFile,
} from "../../lib/batchUpload";
import { readPhotoExif } from "../../lib/exif";
import { MAX_IMAGES, VALID_IMAGE_TYPES } from "../../lib/imageSelection";
import { DEFAULT_LICENSE } from "../../lib/licenses";
import { warmSpeciesId } from "../../lib/speciesIdWarmup";
import { fileToBase64, getErrorMessage } from "../../lib/utils";
import { BatchCard, KEEPS_SELECTION, type CardDropState } from "./BatchCard";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { BatchEditor } from "./BatchEditor";
import { SkippedFilesDialog } from "./SkippedFilesDialog";

/** Observations sent at once. Each request carries its photos, so keep it low. */
const UPLOAD_CONCURRENCY = 3;
/** Files read for EXIF at once; each read holds the whole file in memory. */
const EXIF_CONCURRENCY = 4;

/** What is being dragged within the page. `null` during a drag means files from outside. */
type Drag =
  | { kind: "cards"; photoIds: string[]; sourceIds: string[] }
  | { kind: "photo"; photoIds: string[]; sourceId: string };

/** The drop target under the pointer: a card id, or "new" for a new observation. */
interface Over {
  id: string;
  insertionIndex: number | null;
  /** How many files from outside the page are being dragged; 0 for a drag within it. */
  files: number;
}

const NEW_OBSERVATION = "new";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

let photoSeq = 0;

function ToolbarButton({
  icon,
  children,
  ...props
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  color?: "inherit" | "error";
}) {
  return (
    <Button variant="outlined" color="inherit" size="small" startIcon={icon} {...props}>
      {children}
    </Button>
  );
}

export function BatchUploadPage() {
  usePageTitle("Batch upload");
  const theme = useTheme();
  const appDispatch = useAppDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAppSelector((s) => s.auth.user);
  const isAuthLoading = useAppSelector((s) => s.auth.isLoading);
  const license = useUserPreferences().data?.defaultLicense ?? DEFAULT_LICENSE;

  const [state, dispatch] = useReducer(batchReducer, initialBatchState);
  const [uploading, setUploading] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [skipped, setSkipped] = useState<{ files: SkippedFile[]; added: number }>({
    files: [],
    added: 0,
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  // Mirrors `drag` without waiting for a render: dragover fires before the
  // deferred setDrag lands, and has to know what is being dragged.
  const dragRef = useRef<Drag | null>(null);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { observations, selected, uploadedCount } = state;
  const photoCount = observations.reduce((count, o) => count + o.photos.length, 0);
  const picked = observations.filter((o) => selected.includes(o.id));
  const incomplete = observations.filter((o) => !isReading(o) && missingFields(o).length > 0);
  const failedCount = observations.filter((o) => o.status === "failed").length;
  // The filter lapses once nothing is incomplete, so the grid never empties itself.
  const filtering = onlyIncomplete && incomplete.length > 0;
  const shown = filtering ? incomplete : observations;
  const blocked =
    observations.length === 0 || incomplete.length > 0 || observations.some(isReading);
  const total = uploadedCount + observations.length;
  const profilePath = user ? `/profile/${encodeURIComponent(user.did)}` : "/";

  // Wake the species-id service now so it is up by the time a visual ID runs.
  useEffect(() => warmSpeciesId(), []);

  // Photos and edits live only in this page, so confirm before losing them.
  const hasUnsent = observations.length > 0;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsent && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!hasUnsent) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsent]);

  // Release previews still held when the page goes away. Uploaded photos have
  // already left the state: their previews stand in for the real images in the
  // feeds until the ingester catches up, so they are deliberately kept.
  const heldPhotos = useRef<BatchPhoto[]>([]);
  useEffect(() => {
    heldPhotos.current = observations.flatMap((o) => o.photos);
  }, [observations]);
  useEffect(() => () => heldPhotos.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  // Once every observation has been uploaded (or removed), go see them.
  useEffect(() => {
    if (uploading || hasUnsent || uploadedCount === 0) return;
    toast.success(`${plural(uploadedCount, "observation")} uploaded`);
    void navigate(profilePath);
  }, [uploading, hasUnsent, uploadedCount, toast, navigate, profilePath]);

  /** Add files as new observations, or to `target` when they were dropped on its card. */
  const addFiles = (files: File[], target?: BatchObservation) => {
    if (files.length === 0) return;
    const { accepted, skipped: skippedFiles } = vetBatchFiles(files, photoCount);
    if (target && target.photos.length + accepted.length > MAX_IMAGES) {
      toast.error(`An observation holds up to ${MAX_IMAGES} photos`);
      return;
    }
    if (skippedFiles.length > 0) setSkipped({ files: skippedFiles, added: accepted.length });
    if (accepted.length === 0) return;

    const photos: BatchPhoto[] = accepted.map((file) => ({
      id: `p${++photoSeq}`,
      file,
      previewUrl: URL.createObjectURL(file),
      exif: null,
    }));
    dispatch({ type: "addPhotos", photos, ...(target ? { targetId: target.id } : {}) });
    void runPool(photos, EXIF_CONCURRENCY, async (photo) => {
      dispatch({ type: "exifLoaded", photoId: photo.id, exif: await readPhotoExif(photo.file) });
    });
  };

  const handlePickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const removeSelected = () => {
    picked.forEach((o) => o.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl)));
    dispatch({ type: "removeSelected" });
  };

  const upload = async (targets: BatchObservation[]) => {
    const ids = targets.map((o) => o.id);
    cancelledRef.current = false;
    setUploading(true);
    dispatch({ type: "clearSelection" });
    dispatch({ type: "setStatus", ids, status: "queued" });

    // Editing is locked while this runs, so `targets` stays accurate.
    await runPool(targets, UPLOAD_CONCURRENCY, async (observation) => {
      if (cancelledRef.current) return;
      dispatch({ type: "setStatus", ids: [observation.id], status: "uploading" });
      try {
        const images = await Promise.all(
          observation.photos.map(async (p) => ({
            data: await fileToBase64(p.file),
            mimeType: p.file.type,
          })),
        );
        const input = toObservationInput(observation, license, images);
        const result = await submitObservation(input);
        if (user) {
          prependOccurrence(
            makeTombstoneOccurrence({
              uri: result.uri,
              cid: result.cid,
              observer: user,
              latitude: input.latitude,
              longitude: input.longitude,
              uncertaintyMeters: observation.uncertaintyMeters,
              eventDate: toEventDate(observation),
              scientificName: input.scientificName,
              kingdom: input.kingdom,
              rank: observation.taxon.match?.rank ?? (observation.taxon.rank || undefined),
              imageUrls: observation.photos.map((p) => p.previewUrl),
              license,
              occurrenceRemarks: input.occurrenceRemarks,
              createdAt: new Date().toISOString(),
            }),
            user.did,
          );
        }
        // Quiet: one toast for the whole batch, not one per observation.
        void appDispatch(
          trackSubmission({ uri: result.uri, cid: result.cid, kind: "create", quiet: true }),
        );
        dispatch({ type: "uploaded", id: observation.id });
      } catch (error) {
        dispatch({
          type: "setStatus",
          ids: [observation.id],
          status: "failed",
          error: getErrorMessage(error),
        });
      }
    });

    dispatch({ type: "resetQueued" });
    setUploading(false);
  };

  // A click on the page's background drops the selection. Buttons, cards, and
  // the editor keep it, as do dialogs and menus: those render outside this
  // element, though their clicks still bubble here through React.
  const isBackground = (event: MouseEvent) => {
    const { target } = event;
    return (
      target instanceof Element &&
      event.currentTarget.contains(target) &&
      !target.closest(`button, a, input, textarea, label, [${KEEPS_SELECTION}]`)
    );
  };
  // The press has to start on the background too. A drag that starts in the
  // editor (panning its map, selecting text) and is released outside it still
  // produces a click, on whatever element contains both ends.
  const pressedOnBackground = useRef(false);
  const handleBackgroundClick = (event: MouseEvent) => {
    if (pressedOnBackground.current && isBackground(event) && selected.length > 0) {
      dispatch({ type: "clearSelection" });
    }
  };

  // Drawing a rectangle from the background selects the cards it touches. Until
  // the mouse is released the selection is provisional: the cards show it, but
  // the editor doesn't rebuild itself for every card the rectangle passes over.
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const {
    rectRef: marqueeRef,
    provisional,
    start: startMarquee,
  } = useMarqueeSelection({ bodyRef, sectionRef, controlsRef });
  const shownSelection = provisional ?? selected;

  const handleMouseDown = (event: MouseEvent) => {
    pressedOnBackground.current = isBackground(event);
    if (!pressedOnBackground.current || event.button !== 0 || uploading) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    startMarquee(event, additive ? selected : [], (ids) => {
      // The click that follows the release ends the drag; it isn't a background click.
      pressedOnBackground.current = false;
      dispatch({ type: "selectAll", ids });
    });
  };

  // --- Drag and drop -------------------------------------------------------

  const startDrag = (event: DragEvent, next: Drag) => {
    dragRef.current = next;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", next.photoIds.join(","));
    // Deferred: re-rendering the source during dragstart can cancel the drag.
    setTimeout(() => setDrag(next), 0);
  };

  const endDrag = () => {
    dragRef.current = null;
    // Deferred so it lands after the dragstart timer that sets `drag`.
    setTimeout(() => {
      setDrag(null);
      setOver(null);
    }, 0);
  };

  const updateOver = (next: Over | null) =>
    setOver((prev) =>
      prev?.id === next?.id &&
      prev?.insertionIndex === next?.insertionIndex &&
      prev?.files === next?.files
        ? prev
        : next,
    );

  const isOwnCard = (d: Drag, id: string) =>
    d.kind === "photo" ? d.sourceId === id : d.sourceIds.includes(id);

  const handleCardDragStart = (event: DragEvent, observation: BatchObservation) => {
    // Dragging a selected card carries the rest of the selection with it.
    const group = selected.includes(observation.id) ? picked : [observation];
    startDrag(event, {
      kind: "cards",
      photoIds: group.flatMap((o) => o.photos.map((p) => p.id)),
      sourceIds: group.map((o) => o.id),
    });
  };

  const handleCardDragOver = (
    event: DragEvent,
    observation: BatchObservation,
    insertionIndex: number | null,
  ) => {
    const d = dragRef.current;
    // A card over itself falls through to the page, where it does nothing.
    if (uploading || (d?.kind === "cards" && isOwnCard(d, observation.id))) return;
    event.preventDefault();
    event.stopPropagation();
    if (!d) {
      // Files from outside the page: they will be added to this observation.
      updateOver({
        id: observation.id,
        insertionIndex: null,
        files: event.dataTransfer.items.length,
      });
    } else if (d.kind === "photo" && isOwnCard(d, observation.id)) {
      // Between photo slots the pointer is over the card but no slot; keep the bar.
      setOver((prev) => {
        const kept = prev?.id === observation.id ? prev.insertionIndex : null;
        const next = insertionIndex ?? kept;
        return prev?.id === observation.id && prev.insertionIndex === next
          ? prev
          : { id: observation.id, insertionIndex: next, files: 0 };
      });
    } else {
      updateOver({ id: observation.id, insertionIndex: null, files: 0 });
    }
  };

  const handleCardDrop = (event: DragEvent, observation: BatchObservation) => {
    const d = dragRef.current;
    if (uploading || (d?.kind === "cards" && isOwnCard(d, observation.id))) return;
    event.preventDefault();
    event.stopPropagation();
    if (!d) {
      addFiles(Array.from(event.dataTransfer.files), observation);
      endDrag();
      return;
    }
    const [photoId] = d.photoIds;
    if (d.kind === "photo" && isOwnCard(d, observation.id)) {
      const from = observation.photos.findIndex((p) => p.id === photoId);
      const to = over?.id === observation.id ? over.insertionIndex : null;
      if (photoId && to !== null) {
        dispatch({
          type: "reorderPhoto",
          observationId: observation.id,
          photoId,
          // The slot index counts the dragged photo, which is about to move.
          index: to > from ? to - 1 : to,
        });
      }
    } else {
      // The reducer refuses a combine that would exceed the photo limit.
      dispatch({ type: "movePhotos", photoIds: d.photoIds, targetId: observation.id });
    }
    endDrag();
  };

  const leftElement = (event: DragEvent) =>
    !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget));

  const handlePageDragOver = (event: DragEvent) => {
    // Always claim the event, or the browser opens a dropped file in the tab.
    event.preventDefault();
    if (uploading) return;
    const d = dragRef.current;
    updateOver(
      !d || d.kind === "photo" ? { id: NEW_OBSERVATION, insertionIndex: null, files: 0 } : null,
    );
  };

  const handlePageDrop = (event: DragEvent) => {
    event.preventDefault();
    if (uploading) return;
    const d = dragRef.current;
    if (!d) addFiles(Array.from(event.dataTransfer.files));
    else if (d.kind === "photo")
      dispatch({ type: "movePhotos", photoIds: d.photoIds, targetId: null });
    endDrag();
  };

  /** Photos a drop on this card would bring in, from the page or from outside it. */
  const incomingCount = (observation: BatchObservation) =>
    over?.id !== observation.id ? 0 : drag ? drag.photoIds.length : over.files;

  const dropStateFor = (observation: BatchObservation): CardDropState => {
    const incoming = incomingCount(observation);
    if (incoming === 0 || (drag && isOwnCard(drag, observation.id))) return "none";
    if (observation.photos.length + incoming > MAX_IMAGES) return "refuse";
    return drag ? "combine" : "add";
  };

  // --- Render --------------------------------------------------------------

  if (!user) {
    return isAuthLoading ? null : <EmptyState message="Log in to upload observations." />;
  }

  const overNew = over?.id === NEW_OBSERVATION;
  const allFailed = failedCount > 0 && failedCount === observations.length;
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={VALID_IMAGE_TYPES.join(",")}
      onChange={handlePickFiles}
      style={{ display: "none" }}
      data-testid="batch-file-input"
    />
  );
  const dropZoneSx = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    p: 2.5,
    borderRadius: 2,
    border: 2,
    borderStyle: "dashed",
    borderColor: overNew ? "primary.main" : "divider",
    bgcolor: overNew ? "action.hover" : "transparent",
    color: "text.secondary",
    textAlign: "center",
  } as const;

  return (
    <Box
      onDragOver={handlePageDragOver}
      onDragLeave={(event) => {
        if (leftElement(event)) updateOver(null);
      }}
      onDrop={handlePageDrop}
      onMouseDown={handleMouseDown}
      onClick={handleBackgroundClick}
      // The header and controls stay put; only the area below them scrolls.
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        // Drawing a selection rectangle shouldn't also select the text under it.
        userSelect: provisional ? "none" : "auto",
      }}
    >
      <Box
        ref={marqueeRef}
        aria-hidden
        sx={{
          // Positioned and shown by useMarqueeSelection while a rectangle is drawn.
          display: "none",
          position: "fixed",
          border: 1,
          borderColor: "primary.main",
          bgcolor: alpha(theme.palette.primary.main, 0.15),
          pointerEvents: "none",
          zIndex: theme.zIndex.tooltip,
        }}
      />
      {fileInput}
      <Box sx={{ flexShrink: 0, px: 3, pt: 2.5 }}>
        <Box
          component="header"
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "12px 20px",
            mb: 2,
          }}
        >
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, flex: "1 1 240px" }}>
            Batch upload
          </Typography>
          {uploading ? (
            <>
              <Box sx={{ flex: "1 1 280px", maxWidth: 420 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1.5, mb: 0.75 }}>
                  <Typography sx={{ fontWeight: 600 }}>Uploading</Typography>
                  <Typography sx={{ color: "text.secondary" }}>
                    {uploadedCount} of {total} uploaded
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(uploadedCount / total) * 100}
                  aria-label="Upload progress"
                />
              </Box>
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => {
                  cancelledRef.current = true;
                  dispatch({ type: "resetQueued" });
                }}
              >
                Cancel remaining
              </Button>
            </>
          ) : (
            <>
              <Typography sx={{ color: "text.secondary" }}>
                {uploadedCount > 0
                  ? `${uploadedCount} of ${total} uploaded`
                  : `${plural(observations.length, "observation")}, ${plural(photoCount, "photo")}`}
              </Typography>
              {failedCount > 0 && (
                <Typography
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    color: "error.main",
                    fontWeight: 600,
                  }}
                >
                  <ErrorIcon fontSize="small" />
                  {failedCount} failed
                </Typography>
              )}
              {incomplete.length > 0 && !filtering && (
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<WarningAmberIcon />}
                  onClick={() => setOnlyIncomplete(true)}
                >
                  {incomplete.length} incomplete
                </Button>
              )}
              {filtering && (
                <Button variant="outlined" color="inherit" onClick={() => setOnlyIncomplete(false)}>
                  Show all
                </Button>
              )}
              <Button
                variant="contained"
                disabled={blocked}
                startIcon={allFailed ? <RefreshIcon /> : <CloudUploadIcon />}
                onClick={() => void upload(observations)}
              >
                {allFailed
                  ? "Retry all failed"
                  : observations.length > 0
                    ? `Upload ${plural(observations.length, "observation")}`
                    : "Upload"}
              </Button>
            </>
          )}
        </Box>

        {observations.length > 0 && (
          <>
            {uploading ? (
              <Typography sx={{ color: "text.secondary", mb: 2 }}>
                Uploaded observations leave this list. Editing is paused until the upload finishes.
              </Typography>
            ) : (
              failedCount > 0 && (
                <Typography sx={{ color: "text.secondary", mb: 2 }}>
                  {plural(failedCount, "observation")} {failedCount === 1 ? "was" : "were"} not
                  uploaded. You can edit {failedCount === 1 ? "it" : "them"} and try again.{" "}
                  {uploadedCount > 0 && (
                    <MuiLink component={Link} to={profilePath} sx={{ fontWeight: 600 }}>
                      View the {plural(uploadedCount, "uploaded observation")}
                    </MuiLink>
                  )}
                </Typography>
              )
            )}
          </>
        )}
      </Box>

      <Box ref={bodyRef} sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, pb: 2.5 }}>
        {observations.length === 0 ? (
          <Box sx={[dropZoneSx, { minHeight: 360 }]}>
            <FileUploadIcon fontSize="large" />
            <Typography variant="h6" component="h2" sx={{ color: "text.primary", fontWeight: 700 }}>
              Drag photos here
            </Typography>
            <Typography sx={{ maxWidth: 480 }}>
              Each photo starts as its own observation. Date and location are read from the photo
              when it has them. You can combine photos of the same organism afterward.
            </Typography>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => fileInputRef.current?.click()}
            >
              Browse files
            </Button>
            <Typography variant="body2">
              JPEG, PNG, or WebP. 10 MB each, up to {MAX_BATCH_PHOTOS} photos.
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              gap: 3,
              // Side by side, the grid and the editor each scroll on their own, so
              // the editor stays in view however long the grid is. Below `lg` the
              // editor may wrap under the grid and the two scroll together.
              [theme.breakpoints.up("lg")]: { flexWrap: "nowrap", height: "100%" },
            }}
          >
            <Box
              component="section"
              ref={sectionRef}
              aria-label="Observations"
              sx={{
                flex: "999 1 560px",
                minWidth: 0,
                [theme.breakpoints.up("lg")]: { height: "100%", overflowY: "auto" },
              }}
            >
              {!uploading && (
                <Box
                  ref={controlsRef}
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 1,
                    // Stays at the top of the cards it acts on while they scroll
                    // under it, so it needs a solid backing.
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    px: 0.5,
                    pb: 2,
                    bgcolor: "background.default",
                  }}
                >
                  <Typography sx={{ flex: "1 1 160px", color: "text.secondary" }}>
                    {filtering && `Showing ${incomplete.length} incomplete. `}
                    {shownSelection.length > 0
                      ? `${shownSelection.length} selected`
                      : "Drag cards together to combine them"}
                  </Typography>
                  <ToolbarButton
                    icon={<SelectAllIcon />}
                    onClick={() => dispatch({ type: "selectAll", ids: shown.map((o) => o.id) })}
                  >
                    Select all
                  </ToolbarButton>
                  <ToolbarButton
                    icon={<DeselectIcon />}
                    disabled={picked.length === 0}
                    onClick={() => dispatch({ type: "clearSelection" })}
                  >
                    Clear
                  </ToolbarButton>
                  {/* Space, not a rule, between choosing cards and changing them. */}
                  <Box aria-hidden sx={{ width: 16 }} />
                  <ToolbarButton
                    icon={<CallMergeIcon />}
                    disabled={!canCombine(picked)}
                    onClick={() => dispatch({ type: "combineSelected" })}
                  >
                    Combine
                  </ToolbarButton>
                  <ToolbarButton
                    icon={<CallSplitIcon />}
                    disabled={!picked.some((o) => o.photos.length > 1)}
                    onClick={() => dispatch({ type: "splitSelected" })}
                  >
                    Split photos
                  </ToolbarButton>
                  <ToolbarButton
                    icon={<DeleteOutlineIcon />}
                    color="error"
                    disabled={picked.length === 0}
                    onClick={removeSelected}
                  >
                    Remove
                  </ToolbarButton>
                </Box>
              )}
              <Box
                sx={{
                  display: "grid",
                  // Room for the cards' borders and shadows inside the scroll box.
                  p: 0.5,
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 2,
                  alignItems: "start",
                }}
              >
                {shown.map((observation) => (
                  <BatchCard
                    key={observation.id}
                    observation={observation}
                    selected={shownSelection.includes(observation.id)}
                    locked={uploading}
                    dropState={dropStateFor(observation)}
                    combinedPhotoCount={observation.photos.length + incomingCount(observation)}
                    insertionIndex={
                      drag?.kind === "photo" && over?.id === observation.id
                        ? over.insertionIndex
                        : null
                    }
                    draggingPhotoId={
                      drag?.kind === "photo" && drag.sourceId === observation.id
                        ? (drag.photoIds[0] ?? null)
                        : null
                    }
                    onSelect={(additive) =>
                      dispatch({ type: "select", id: observation.id, additive })
                    }
                    onCardDragStart={(event) => handleCardDragStart(event, observation)}
                    onPhotoDragStart={(event, photoId) =>
                      startDrag(event, {
                        kind: "photo",
                        photoIds: [photoId],
                        sourceId: observation.id,
                      })
                    }
                    onDragEnd={endDrag}
                    onDragOver={(event, index) => handleCardDragOver(event, observation, index)}
                    onDragLeave={(event) => {
                      if (leftElement(event)) updateOver(null);
                    }}
                    onDrop={(event) => handleCardDrop(event, observation)}
                    onRetry={() => void upload([observation])}
                  />
                ))}
                {!uploading && (
                  <Box sx={[dropZoneSx, { minHeight: 260 }]}>
                    <FileUploadIcon fontSize="large" />
                    <Typography sx={{ color: "text.primary", fontWeight: 600 }}>
                      {overNew && drag ? "Drop to make a new observation" : "Add photos"}
                    </Typography>
                    <Typography variant="body2">
                      {overNew && drag
                        ? "Date and location come from the photo. Identification starts blank."
                        : "Drop photos here to start new observations, or onto a card to add " +
                          "them to it. Drag a photo out of a card to give it its own observation."}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="inherit"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Browse files
                    </Button>
                  </Box>
                )}
              </Box>
            </Box>
            {!uploading && (
              <Box
                {...{ [KEEPS_SELECTION]: "" }}
                sx={{
                  flex: "1 1 320px",
                  minWidth: 0,
                  [theme.breakpoints.up("lg")]: {
                    flex: "0 0 360px",
                    height: "100%",
                    overflowY: "auto",
                  },
                }}
              >
                <BatchEditor
                  selected={picked}
                  onEdit={(patch) => dispatch({ type: "edit", patch })}
                />
              </Box>
            )}
          </Box>
        )}
      </Box>

      <SkippedFilesDialog
        skipped={skipped.files}
        addedCount={skipped.added}
        onClose={() => setSkipped({ files: [], added: 0 })}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Leave batch upload?"
        message={
          `${plural(observations.length, "observation")} ` +
          `${observations.length === 1 ? "hasn't" : "haven't"} been uploaded. Photos and edits ` +
          "aren't saved, so leaving will lose them."
        }
        cancelLabel="Keep editing"
        confirmLabel="Leave"
        destructive
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </Box>
  );
}
