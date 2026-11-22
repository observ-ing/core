// Create/edit observation modal, structured as an MUI vertical <Stepper>
// (https://mui.com/material-ui/react-stepper/): Photos → Location → Identify →
// Date & details. Location is the only required step and gates leaving it; the
// rest are optional and skippable straight to Submit. Driven by the Redux
// `uploadModalOpen` flag.
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  Box,
  ButtonBase,
  Typography,
  TextField,
  Button,
  Stack,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stepper,
  Step,
  StepButton,
  StepContent,
  Checkbox,
  FormControlLabel,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeUploadModal, consumePendingUploadFiles } from "../../store/uiSlice";
import { trackSubmission } from "../../store/pendingSlice";
import { makeTombstoneOccurrence, prependOccurrence } from "../../lib/query/occurrenceCache";
import { useToast } from "../../hooks/useToast";
import { useBatchLayout } from "../../hooks/useBatchLayout";
import {
  useUserPreferences,
  useCrosspostStatus,
  useMaxPhotoSize,
  useInatAccount,
} from "../../lib/query/hooks";
import { defaultCrosspost } from "../../lib/crosspost";
import { hasInatRecord } from "../../lib/externalRecords";
import { useSubmitObservation, useUpdateObservation } from "../../lib/query/mutations";
import { validateTaxon } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import type { ExternalRecord } from "../../bindings/ExternalRecord";
import { ModalOverlay } from "./ModalOverlay";
import { coverImageSx, cornerPinSx, miniIconSx, thumbnailFrameSx } from "../common/layoutSx";
import { CenteredSpinner } from "../common/CenteredSpinner";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { ButtonSpinner } from "../common/ButtonSpinner";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { TaxonMatchChip } from "../common/TaxonMatchChip";
import { KingdomSelect } from "../common/KingdomSelect";
import { RankSelect } from "../common/RankSelect";
import { LicenseSelect } from "../common/LicenseSelect";
import { TimeZoneSelect } from "../common/TimeZoneSelect";
import { ExternalRecordsField } from "./ExternalRecordsField";
import { VisualId } from "../identification/VisualId";
import { PhotoLightbox } from "../observation/PhotoLightbox";
import { getErrorMessage, fileToBase64, formatCoordinate } from "../../lib/utils";
import { pickPhotos } from "../../lib/photoPicker";
import {
  IMAGE_INPUT_ACCEPT,
  MAX_IMAGES,
  formatMegabytes,
  vetImageFiles,
} from "../../lib/imageSelection";
import { convertHeicFiles, isHeic } from "../../lib/heic";
import { readPhotoExif } from "../../lib/exif";
import { taxonFields, toEventDate } from "../../lib/observationInput";
import { MAX_REMARK_LENGTH } from "../../lib/remarks";
import { DEFAULT_LICENSE } from "../../lib/licenses";
import { warmSpeciesId } from "../../lib/speciesIdWarmup";

const LocationPicker = lazy(() =>
  import("../map/LocationPicker").then((m) => ({ default: m.LocationPicker })),
);

/** A photo in the form: one already on the observation being edited, or one added here. */
type FormPhoto =
  | { kind: "existing"; key: string; url: string }
  | { kind: "new"; key: string; file: File; preview: string };

const photoSrc = (photo: FormPhoto) => (photo.kind === "existing" ? photo.url : photo.preview);

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface ImageThumbnailProps {
  src: string;
  /** 1-based position among the form's photos. */
  position: number;
  /** The primary pointer is a finger, so a long press starts a drag. */
  touch: boolean;
  /** Faded while it is the photo being dragged. */
  lifted: boolean;
  /** Which side, if any, shows the bar marking where a dragged photo would land. */
  insertionBar: "left" | "right" | null;
  onEnlarge: () => void;
  onRemove: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
}

function ImageThumbnail({
  src,
  position,
  touch,
  lifted,
  insertionBar,
  onEnlarge,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
}: ImageThumbnailProps) {
  const theme = useTheme();
  return (
    <Box
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      // On touch a long press starts a drag, so the system's menu for the photo
      // stays out of the way.
      onContextMenu={touch ? (event) => event.preventDefault() : undefined}
      sx={{
        ...(touch && { userSelect: "none", WebkitTouchCallout: "none" }),
        position: "relative",
        width: 80,
        height: 80,
        cursor: "grab",
        opacity: lifted ? 0.35 : 1,
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: "100%",
          ...thumbnailFrameSx,
          border: 1,
          borderColor: "divider",
        }}
      >
        <ButtonBase
          onClick={onEnlarge}
          aria-label={`Enlarge photo ${position}`}
          sx={{ display: "block", width: "100%", height: "100%", cursor: "zoom-in" }}
        >
          <Box
            component="img"
            src={src}
            alt={`Photo ${position}`}
            draggable={false}
            // A long press lands on the tile, not the image: on an image, iOS
            // Safari opens its own menu instead of starting a drag.
            sx={[coverImageSx, { pointerEvents: "none" }]}
          />
        </ButtonBase>
      </Box>
      {insertionBar && (
        <Box
          aria-hidden
          data-testid="photo-insertion-bar"
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            [insertionBar]: -6,
            width: 4,
            borderRadius: 0.5,
            bgcolor: "primary.main",
          }}
        />
      )}
      <IconButton
        size="small"
        onClick={onRemove}
        aria-label={`Remove photo ${position}`}
        sx={[
          cornerPinSx("top-right", { size: "xs" }),
          {
            bgcolor: theme.palette.overlay["modalChip"],
            color: "common.white",
            width: 20,
            height: 20,
            "&:hover": { bgcolor: "error.main" },
          },
        ]}
      >
        <CloseIcon sx={miniIconSx} />
      </IconButton>
    </Box>
  );
}

const ORGANISM_QUANTITY_TYPES = [
  { value: "individuals", label: "Individuals" },
  { value: "percent-cover", label: "Percent cover" },
] as const;
const DEFAULT_ORGANISM_QUANTITY_TYPE = "individuals";

// Index of each step in the vertical stepper. Location is the only required
// step; the rest are optional and can be skipped straight to submit.
const STEP_PHOTOS = 0;
const STEP_LOCATION = 1;
const STEP_IDENTIFY = 2;
const STEP_DETAILS = 3;
const LAST_STEP = STEP_DETAILS;

export function UploadModal() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const isOpen = useAppSelector((state) => state.ui.uploadModalOpen);
  const editingObservation = useAppSelector((state) => state.ui.editingObservation);
  const prefs = useUserPreferences().data;
  const defaultLicense = prefs?.defaultLicense ?? null;
  const inatLogin = useInatAccount().data?.login;
  const maxPhotoSize = useMaxPhotoSize();
  const { touch, touchDrag } = useBatchLayout();
  const currentLocation = useAppSelector((state) => state.ui.currentLocation);
  const currentUser = useAppSelector((state) => state.auth.user);

  const isEditMode = !!editingObservation;
  // Which external record, if any, cross-posting added to the one being edited.
  const crosspostStatus = useCrosspostStatus(editingObservation?.uri, isEditMode);

  const submitObs = useSubmitObservation();
  const updateObs = useUpdateObservation();
  const isSubmitting = submitObs.isPending || updateObs.isPending;

  const [activeStep, setActiveStep] = useState(STEP_PHOTOS);
  const [species, setSpecies] = useState("");
  const [matchedTaxon, setMatchedTaxon] = useState<TaxaResult | null>(null);
  const [kingdom, setKingdom] = useState("");
  const [rank, setRank] = useState("");
  const [license, setLicense] = useState<string>(DEFAULT_LICENSE);
  // The user's own choice to post to iNaturalist, or null to follow the
  // default from their preferences.
  const [crosspostChoice, setCrosspostChoice] = useState<boolean | null>(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  // Every photo the observation will have, in order.
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  // The key of the photo being dragged, and the slot it would land in.
  const [draggingPhoto, setDraggingPhoto] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<number | null>(null);
  const [observationDate, setObservationDate] = useState(() => toDatetimeLocal(new Date()));
  const [observationEndDate, setObservationEndDate] = useState("");
  /** UTC offset `observationDate` is in; `null` means the browser's own zone. */
  const [utcOffset, setUtcOffset] = useState<string | null>(null);
  const [uncertaintyMeters, setUncertaintyMeters] = useState(50);
  const [organismQuantity, setOrganismQuantity] = useState("");
  const [organismQuantityType, setOrganismQuantityType] = useState<string>(
    DEFAULT_ORGANISM_QUANTITY_TYPE,
  );
  const [externalRecords, setExternalRecords] = useState<ExternalRecord[]>([]);
  const [occurrenceRemarks, setOccurrenceRemarks] = useState("");
  const [visualIdImageUrl, setVisualIdImageUrl] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [isConvertingPhotos, setIsConvertingPhotos] = useState(false);
  // HEIC conversion makes adding photos async. These let a batch that finishes
  // converting vet against the current photo count, and drop itself if the
  // form was reset (e.g. the modal closed) in the meantime.
  const imageCountRef = useRef(0);
  const formGenerationRef = useRef(0);

  useEffect(() => {
    imageCountRef.current = photos.length;
  }, [photos.length]);

  const hasLocation = !!lat && !!lng;

  // Wake the species-id service now so it boots while the user picks a photo
  // and location, instead of when the visual ID actually runs.
  useEffect(() => {
    if (isOpen) warmSpeciesId();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setIsDirty(false);
    setActiveStep(STEP_PHOTOS);
    setOrganismQuantity("");
    setOrganismQuantityType(DEFAULT_ORGANISM_QUANTITY_TYPE);
    setExternalRecords([]);
    setOccurrenceRemarks("");
    if (!editingObservation) {
      setLicense(defaultLicense ?? DEFAULT_LICENSE);
      if (currentLocation) {
        setLat(formatCoordinate(currentLocation.lat));
        setLng(formatCoordinate(currentLocation.lng));
      }
      const pending = consumePendingUploadFiles();
      if (pending.length > 0) {
        void addFiles(pending);
      }
      return undefined;
    }

    const existingName = editingObservation.effectiveTaxonomy?.scientificName || "";
    const existingKingdom = editingObservation.effectiveTaxonomy?.kingdom || "";
    setSpecies(existingName);
    setKingdom(existingKingdom);
    setMatchedTaxon(null);
    setRank("");
    if (editingObservation.eventDate) {
      const parts = editingObservation.eventDate.split("/");
      const start = parts[0] ?? editingObservation.eventDate;
      const end = parts[1];
      if (end) {
        setObservationDate(`${start.slice(0, 10)}T00:00`);
        setObservationEndDate(end.slice(0, 10));
      } else {
        setObservationDate(toDatetimeLocal(new Date(start)));
        setObservationEndDate("");
      }
      // A saved eventDate is an instant with no zone of its own, so it is shown
      // in local time; choosing another zone re-reads the same clock time in it.
      setUtcOffset(null);
    }
    if (editingObservation.location) {
      setLat(formatCoordinate(editingObservation.location.latitude));
      setLng(formatCoordinate(editingObservation.location.longitude));
      if (editingObservation.location.uncertaintyMeters) {
        setUncertaintyMeters(editingObservation.location.uncertaintyMeters);
      }
    }
    // Keyed by position too: the same photo added twice is two images with one
    // URL. Photos added here stay if this runs again while the form is open,
    // such as when the preferences finish loading.
    const existingPhotos = (editingObservation.images || []).map((img, index): FormPhoto => ({
      kind: "existing",
      key: `existing-${index}-${img.url}`,
      url: img.url,
    }));
    setPhotos((prev) => [...existingPhotos, ...prev.filter((photo) => photo.kind === "new")]);
    if (editingObservation.organismQuantity) {
      setOrganismQuantity(editingObservation.organismQuantity);
      setOrganismQuantityType(
        editingObservation.organismQuantityType || DEFAULT_ORGANISM_QUANTITY_TYPE,
      );
    }
    // The edit request replaces the record's whole array, so the form has to
    // start from what is already on it or saving would drop the entries.
    setExternalRecords(editingObservation.externalRecords ?? []);
    // Likewise, an edit that omits a remark deletes it.
    setOccurrenceRemarks(editingObservation.occurrenceRemarks ?? "");

    if (!existingName) return undefined;
    const controller = new AbortController();
    validateTaxon(existingName, existingKingdom || undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result?.valid && result.taxon) {
          setMatchedTaxon(result.taxon);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [isOpen, currentLocation, editingObservation, defaultLicense]);

  const resetForm = () => {
    formGenerationRef.current += 1;
    setActiveStep(STEP_PHOTOS);
    setSpecies("");
    setMatchedTaxon(null);
    setKingdom("");
    setRank("");
    setLicense(isEditMode ? DEFAULT_LICENSE : (defaultLicense ?? DEFAULT_LICENSE));
    setCrosspostChoice(null);
    photos.forEach((photo) => {
      if (photo.kind === "new") URL.revokeObjectURL(photo.preview);
    });
    setPhotos([]);
    setObservationDate(toDatetimeLocal(new Date()));
    setObservationEndDate("");
    setUtcOffset(null);
    setUncertaintyMeters(50);
    setOrganismQuantity("");
    setOrganismQuantityType(DEFAULT_ORGANISM_QUANTITY_TYPE);
    setExternalRecords([]);
    setOccurrenceRemarks("");
    setVisualIdImageUrl(null);
    setIsDirty(false);
  };

  const handleRequestClose = () => {
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    dispatch(closeUploadModal());
    resetForm();
  };

  const handleConfirmDiscard = () => {
    setDiscardConfirmOpen(false);
    dispatch(closeUploadModal());
    resetForm();
  };

  const addFiles = async (picked: File[]) => {
    const generation = formGenerationRef.current;
    let files = picked;
    if (picked.some(isHeic)) {
      setIsConvertingPhotos(true);
      try {
        const converted = await convertHeicFiles(picked);
        if (formGenerationRef.current !== generation) return;
        files = converted.files;
        for (const failure of converted.failures) {
          toast.error(failure.message);
        }
      } finally {
        setIsConvertingPhotos(false);
      }
    }

    const currentCount = imageCountRef.current;
    const { accepted, invalidType, tooLarge, exceededCap } = vetImageFiles(files, currentCount, {
      maxFileSize: maxPhotoSize.bytes,
    });

    for (const file of invalidType) {
      toast.error(`Invalid file type: ${file.name}. Use JPG, PNG, WebP, or HEIC.`);
    }
    for (const file of tooLarge) {
      const max = formatMegabytes(maxPhotoSize.bytes);
      toast.error(
        maxPhotoSize.limitedByPds
          ? `File too large: ${file.name}. Your PDS accepts photos up to ${max}.`
          : `File too large: ${file.name}. Max size is ${max}.`,
      );
    }
    if (exceededCap) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed.`);
    }
    if (accepted.length === 0) return;

    const isFirstPhoto = currentCount === 0;
    const additions = accepted.map((file) => {
      const preview = URL.createObjectURL(file);
      return { kind: "new" as const, key: `new-${preview}`, file, preview };
    });
    setPhotos((prev) => [...prev, ...additions]);
    setIsDirty(true);

    // Only the observation's very first photo seeds the date/location and the
    // visual ID; the rest of the batch is just attached.
    const first = additions[0];
    if (isFirstPhoto && first) {
      extractExifData(first.file);
      if (!species && !isEditMode) {
        setVisualIdImageUrl(first.preview);
      }
    }
  };

  const handlePickImages = async () => {
    if (photos.length >= MAX_IMAGES) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed.`);
      return;
    }
    const files = await pickPhotos({ multiple: true });
    if (files.length > 0) await addFiles(files);
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const extractExifData = async (file: File) => {
    const exif = await readPhotoExif(file);
    if (exif.latitude != null && exif.longitude != null) {
      setLat(formatCoordinate(exif.latitude));
      setLng(formatCoordinate(exif.longitude));
      if (exif.accuracyMeters !== null) setUncertaintyMeters(exif.accuracyMeters);
      toast.success("Location extracted from photo EXIF data");
    }
    if (exif.date) {
      setObservationDate(exif.date);
      setUtcOffset(exif.utcOffset);
    }
  };

  const handleRemovePhoto = (key: string) => {
    setPhotos((prev) => {
      const removed = prev.find((photo) => photo.key === key);
      if (removed?.kind === "new") URL.revokeObjectURL(removed.preview);
      return prev.filter((photo) => photo.key !== key);
    });
    setIsDirty(true);
  };

  const endPhotoDrag = () => {
    // Deferred so it lands after the dragstart timer that sets `draggingPhoto`:
    // a drag cancelled at once ends before that timer fires.
    setTimeout(() => {
      setDraggingPhoto(null);
      setInsertion(null);
    }, 0);
  };

  const handlePhotoDragStart = (event: DragEvent<HTMLElement>, key: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    // Deferred: re-rendering the source during dragstart can cancel the drag.
    setTimeout(() => setDraggingPhoto(key), 0);
  };

  // Insert before a photo when over its left half, after it when over its right.
  const handlePhotoDragOver = (event: DragEvent<HTMLElement>, index: number) => {
    if (!draggingPhoto) return;
    event.preventDefault();
    const { left, width } = event.currentTarget.getBoundingClientRect();
    setInsertion(event.clientX < left + width / 2 ? index : index + 1);
  };

  const handlePhotoDrop = (event: DragEvent) => {
    event.preventDefault();
    const from = photos.findIndex((photo) => photo.key === draggingPhoto);
    if (insertion !== null && from !== -1) {
      // The slot counts the dragged photo, which is about to move.
      const to = insertion > from ? insertion - 1 : insertion;
      if (to !== from) {
        setPhotos((prev) => {
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          if (moved) next.splice(to, 0, moved);
          return next;
        });
        setIsDirty(true);
      }
    }
    endPhotoDrag();
  };

  const handleUploadClick = () => {
    void handlePickImages();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!lat || !lng) {
      toast.error("Please provide a location");
      setActiveStep(STEP_LOCATION);
      return;
    }

    if (observationEndDate && observationEndDate < observationDate.slice(0, 10)) {
      toast.error("End date can't be before the start date");
      return;
    }
    const eventDate = toEventDate({
      date: observationDate,
      endDate: observationEndDate,
      utcOffset,
    });

    const trimmedSpecies = species.trim();
    if (trimmedSpecies && !matchedTaxon && !kingdom) {
      toast.error("Please select a kingdom for the taxon name you entered");
      setActiveStep(STEP_IDENTIFY);
      return;
    }

    const newPhotos = photos.filter((photo) => photo.kind === "new");
    const imageData = await Promise.all(
      newPhotos.map(async (photo) => ({
        data: await fileToBase64(photo.file),
        mimeType: photo.file.type,
      })),
    );

    const kind: "create" | "update" = isEditMode ? "update" : "create";

    // The PDS write succeeded. Close the modal immediately so the submission
    // feels instant — the ingester poll, completion toast, and cache
    // reconciliation run in the background (surfaced by the TopBar pending
    // indicator). For a create we also splice an optimistic "tombstone" row
    // into the feeds so the new observation shows up right away (dimmed) instead
    // of after the ingester catches up; trackSubmission swaps it for the real
    // record once ingested.
    const onSuccess = (result: { uri: string; cid: string }) => {
      dispatch(closeUploadModal());
      if (kind === "create" && currentUser) {
        prependOccurrence(
          makeTombstoneOccurrence({
            uri: result.uri,
            cid: result.cid,
            observer: currentUser,
            latitude: parseFloat(lat),
            longitude: parseFloat(lng),
            uncertaintyMeters: uncertaintyMeters,
            eventDate,
            scientificName: trimmedSpecies || undefined,
            kingdom: kingdom || undefined,
            rank: matchedTaxon?.rank ?? rank ?? undefined,
            imageUrls: imageData.map((img) => `data:${img.mimeType};base64,${img.data}`),
            license,
            organismQuantity: organismQuantity.trim() || undefined,
            organismQuantityType: organismQuantityType || undefined,
            externalRecords,
            occurrenceRemarks: occurrenceRemarks.trim() || undefined,
            createdAt: new Date().toISOString(),
          }),
          currentUser.did,
        );
      }
      resetForm();
      void dispatch(
        trackSubmission({
          uri: result.uri,
          cid: result.cid,
          kind,
          scientificName: trimmedSpecies || undefined,
        }),
      );
    };
    const onError = (error: Error) => {
      toast.error(`Failed to ${isEditMode ? "update" : "submit"}: ${getErrorMessage(error)}`);
    };

    const commonPayload = {
      ...taxonFields({ name: species, match: matchedTaxon, kingdom, rank }),
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      coordinateUncertaintyInMeters: uncertaintyMeters,
      ...(organismQuantity.trim()
        ? {
            organismQuantity: organismQuantity.trim(),
            ...(organismQuantityType ? { organismQuantityType } : {}),
          }
        : {}),
      license,
      eventDate,
      ...(externalRecords.length > 0 ? { externalRecords } : {}),
      ...(occurrenceRemarks.trim() ? { occurrenceRemarks: occurrenceRemarks.trim() } : {}),
      // The form has no event-remarks input yet, but an edit that omits one
      // deletes it — so carry through any written by another client.
      ...(isEditMode && editingObservation?.eventRemarks
        ? { eventRemarks: editingObservation.eventRemarks }
        : {}),
      ...(imageData.length > 0 ? { images: imageData } : {}),
    };

    if (isEditMode && editingObservation) {
      const photoOrder = photos.map((photo) =>
        photo.kind === "existing"
          ? { retained: photo.url.split("/").at(-1) ?? "" }
          : { new: newPhotos.indexOf(photo) },
      );
      // A server that predates `photoOrder` ignores it and reads a missing
      // `retainedBlobCids` as keeping no photos, so send both; one that knows
      // `photoOrder` ignores `retainedBlobCids`.
      const retainedBlobCids = photoOrder.flatMap((entry) =>
        "retained" in entry ? [entry.retained] : [],
      );
      updateObs.mutate(
        { uri: editingObservation.uri, ...commonPayload, photoOrder, retainedBlobCids },
        { onSuccess, onError },
      );
    } else {
      submitObs.mutate(
        { ...commonPayload, ...(offerCrosspost ? { crosspostToInaturalist: crosspost } : {}) },
        { onSuccess, onError },
      );
    }
  };

  const handleLocationChange = (newLat: number, newLng: number) => {
    setLat(formatCoordinate(newLat));
    setLng(formatCoordinate(newLng));
    setIsDirty(true);
  };

  // Short summary shown under each step's title once it's been filled in, so the
  // collapsed steps still convey what was entered.
  const photoCount = photos.length;

  // Only for a new observation: an existing one is posted from its details.
  const offerCrosspost = !isEditMode && !!inatLogin;
  // An observation that already links to one on iNaturalist isn't posted
  // there again; the server would skip it anyway.
  const alreadyOnInat = hasInatRecord(externalRecords);
  // Follows the preferences, so adding a photo can tick it, until the user
  // ticks or unticks it themselves.
  const crosspost = !alreadyOnInat && (crosspostChoice ?? defaultCrosspost(prefs, { photoCount }));
  const stepSummaries: Record<number, string> = {
    [STEP_PHOTOS]:
      photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"}` : "Optional",
    [STEP_LOCATION]: hasLocation ? `${lat}, ${lng}` : "Required",
    [STEP_IDENTIFY]: species.trim() || "Optional — leave blank if unknown",
    [STEP_DETAILS]: observationEndDate
      ? `${observationDate.slice(0, 10)} → ${observationEndDate}`
      : observationDate.replace("T", " ") + (utcOffset ? ` UTC${utcOffset}` : ""),
  };

  // Back/Continue control row rendered at the bottom of each non-final step.
  const StepNav = ({ step, continueDisabled }: { step: number; continueDisabled?: boolean }) => (
    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
      {step > STEP_PHOTOS && (
        <Button onClick={() => setActiveStep((s) => s - 1)} color="inherit" size="small">
          Back
        </Button>
      )}
      <Button
        variant="contained"
        size="small"
        disabled={continueDisabled}
        onClick={() => setActiveStep((s) => s + 1)}
      >
        Continue
      </Button>
    </Stack>
  );

  return (
    <>
      <ModalOverlay open={isOpen} onClose={handleRequestClose}>
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
          {isEditMode ? "Edit Observation" : "New Observation"}
        </Typography>
        <form onSubmit={handleSubmit}>
          <input
            type="file"
            accept={IMAGE_INPUT_ACCEPT}
            multiple
            onChange={handleImageSelect}
            style={{ display: "none" }}
          />

          <Stepper activeStep={activeStep} orientation="vertical" nonLinear>
            {/* Step 1 — Photos (optional) */}
            <Step completed={photoCount > 0}>
              <StepButton
                optional={<Typography variant="caption">{stepSummaries[STEP_PHOTOS]}</Typography>}
                onClick={() => setActiveStep(STEP_PHOTOS)}
              >
                Photos
              </StepButton>
              <StepContent>
                {photoCount > 0 && (
                  <Stack
                    direction="row"
                    spacing={1}
                    onDragOver={(event) => {
                      // Between photos the pointer is over the row but no photo; keep the bar.
                      if (draggingPhoto) event.preventDefault();
                    }}
                    onDrop={handlePhotoDrop}
                    sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}
                  >
                    {photos.map((photo, index) => {
                      const src = photoSrc(photo);
                      const position = index + 1;
                      const showsBar = draggingPhoto !== null;
                      return (
                        <ImageThumbnail
                          key={photo.key}
                          src={src}
                          position={position}
                          touch={touch}
                          lifted={draggingPhoto === photo.key}
                          insertionBar={
                            showsBar && insertion === index
                              ? "left"
                              : showsBar &&
                                  insertion === photos.length &&
                                  index === photos.length - 1
                                ? "right"
                                : null
                          }
                          onEnlarge={() => setLightbox({ src, alt: `Photo ${position}` })}
                          onRemove={() => handleRemovePhoto(photo.key)}
                          onDragStart={(event) => handlePhotoDragStart(event, photo.key)}
                          onDragEnd={endPhotoDrag}
                          onDragOver={(event) => handlePhotoDragOver(event, index)}
                        />
                      );
                    })}
                  </Stack>
                )}
                {/* Not where a long press can't start a drag (Firefox on Android). */}
                {photoCount > 1 && (!touch || touchDrag) && (
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", display: "block", mb: 1 }}
                  >
                    Drag photos to reorder them. The first is the cover.
                  </Typography>
                )}

                {photoCount < MAX_IMAGES && (
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={handleUploadClick}
                    disabled={isConvertingPhotos}
                    startIcon={isConvertingPhotos ? <ButtonSpinner /> : <AddPhotoAlternateIcon />}
                    sx={{
                      borderStyle: "dashed",
                      color: "text.disabled",
                      "&:hover": { borderColor: "primary.main", color: "primary.main" },
                    }}
                  >
                    {isConvertingPhotos
                      ? "Converting photos…"
                      : photoCount === 0
                        ? "Add photos"
                        : "Add more photos"}
                  </Button>
                )}

                <Typography
                  variant="caption"
                  sx={{ color: "text.disabled", display: "block", mt: 0.5 }}
                >
                  JPG, PNG, WebP, or HEIC - Max {formatMegabytes(maxPhotoSize.bytes)} each
                  {maxPhotoSize.limitedByPds && " (set by your PDS)"} - Up to {MAX_IMAGES} photos
                </Typography>

                <StepNav step={STEP_PHOTOS} />
              </StepContent>
            </Step>

            {/* Step 2 — Location (required) */}
            <Step completed={hasLocation}>
              <StepButton
                optional={<Typography variant="caption">{stepSummaries[STEP_LOCATION]}</Typography>}
                onClick={() => setActiveStep(STEP_LOCATION)}
                sx={
                  activeStep > STEP_LOCATION && !hasLocation
                    ? {
                        "& .MuiStepLabel-label": { color: "error.main" },
                        "& .MuiStepIcon-root": { color: "error.main" },
                      }
                    : undefined
                }
              >
                Location
              </StepButton>
              <StepContent>
                <Suspense fallback={<CenteredSpinner sx={{ height: 260 }} />}>
                  <LocationPicker
                    latitude={lat ? parseFloat(lat) : null}
                    longitude={lng ? parseFloat(lng) : null}
                    onChange={handleLocationChange}
                    uncertaintyMeters={uncertaintyMeters}
                    onUncertaintyChange={(m) => {
                      setUncertaintyMeters(m);
                      setIsDirty(true);
                    }}
                  />
                </Suspense>
                <StepNav step={STEP_LOCATION} continueDisabled={!hasLocation} />
              </StepContent>
            </Step>

            {/* Step 3 — Identify (optional) */}
            <Step completed={!!species.trim()}>
              <StepButton
                optional={<Typography variant="caption">{stepSummaries[STEP_IDENTIFY]}</Typography>}
                onClick={() => setActiveStep(STEP_IDENTIFY)}
              >
                Identify
              </StepButton>
              <StepContent>
                <TaxaAutocomplete
                  value={species}
                  onChange={(name) => {
                    setSpecies(name);
                    setIsDirty(true);
                    if (name === "") {
                      setMatchedTaxon(null);
                      setKingdom("");
                      setRank("");
                    }
                  }}
                  onMatchChange={(match) => {
                    setMatchedTaxon(match);
                    if (match?.kingdom) {
                      setKingdom(match.kingdom);
                    }
                    if (match) {
                      setRank("");
                    }
                  }}
                  label="Taxon (optional)"
                  placeholder="e.g. Eschscholzia californica - leave blank if unknown"
                  bottomContent={
                    species.trim() ? (
                      <TaxonMatchChip matchedTaxon={matchedTaxon} />
                    ) : visualIdImageUrl ? (
                      <VisualId
                        imageUrl={visualIdImageUrl}
                        latitude={lat ? parseFloat(lat) : undefined}
                        longitude={lng ? parseFloat(lng) : undefined}
                        onSelect={(s) => {
                          setSpecies(s.scientificName);
                          setIsDirty(true);
                          if (s.taxonMatch) {
                            setMatchedTaxon(s.taxonMatch);
                            setKingdom(s.taxonMatch.kingdom ?? "");
                            setRank("");
                          } else if (s.kingdom) {
                            setKingdom(s.kingdom);
                          }
                        }}
                        onSelectAncestor={(ancestor) => {
                          setSpecies(ancestor.name);
                          setMatchedTaxon(null);
                          setIsDirty(true);
                          if (ancestor.kingdom) setKingdom(ancestor.kingdom);
                          setRank(ancestor.rank);
                        }}
                        disabled={isSubmitting}
                      />
                    ) : undefined
                  }
                />

                {!!species.trim() && !matchedTaxon && (
                  <KingdomSelect
                    idPrefix="kingdom"
                    value={kingdom}
                    onChange={(value) => {
                      setKingdom(value);
                      setIsDirty(true);
                    }}
                  />
                )}

                {!!species.trim() && !matchedTaxon && (
                  <RankSelect
                    idPrefix="rank"
                    value={rank}
                    onChange={(value) => {
                      setRank(value);
                      setIsDirty(true);
                    }}
                  />
                )}

                <StepNav step={STEP_IDENTIFY} />
              </StepContent>
            </Step>

            {/* Step 4 — Details + submit */}
            <Step completed={false}>
              <StepButton
                optional={<Typography variant="caption">{stepSummaries[STEP_DETAILS]}</Typography>}
                onClick={() => setActiveStep(STEP_DETAILS)}
              >
                Date &amp; details
              </StepButton>
              <StepContent>
                <LicenseSelect
                  value={license}
                  onChange={(value) => {
                    setLicense(value);
                    setIsDirty(true);
                  }}
                />

                <TextField
                  fullWidth
                  label={observationEndDate ? "Start date" : "Observation date"}
                  type="datetime-local"
                  value={observationDate}
                  onChange={(e) => {
                    setObservationDate(e.target.value);
                    setIsDirty(true);
                  }}
                  margin="normal"
                  slotProps={{ inputLabel: { shrink: true } }}
                />

                <TimeZoneSelect
                  value={utcOffset}
                  date={observationDate}
                  onChange={(offset) => {
                    setUtcOffset(offset);
                    setIsDirty(true);
                  }}
                  margin="normal"
                />

                <TextField
                  fullWidth
                  label="End date (optional)"
                  type="date"
                  value={observationEndDate}
                  onChange={(e) => {
                    setObservationEndDate(e.target.value);
                    setIsDirty(true);
                  }}
                  margin="normal"
                  error={
                    observationEndDate !== "" && observationEndDate < observationDate.slice(0, 10)
                  }
                  helperText={
                    observationEndDate !== "" && observationEndDate < observationDate.slice(0, 10)
                      ? "End date can't be before the start date."
                      : "Set to record an observation spanning a date range."
                  }
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: { min: observationDate.slice(0, 10) },
                  }}
                />

                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <TextField
                    label="Quantity (optional)"
                    value={organismQuantity}
                    onChange={(e) => {
                      setOrganismQuantity(e.target.value);
                      setIsDirty(true);
                    }}
                    margin="normal"
                    placeholder="e.g. 1, 12, or 10–100"
                    sx={{ flex: 1 }}
                  />
                  <FormControl margin="normal" sx={{ minWidth: 150 }}>
                    <InputLabel id="organism-quantity-type-label">Type</InputLabel>
                    <Select
                      labelId="organism-quantity-type-label"
                      value={organismQuantityType}
                      label="Type"
                      onChange={(e) => {
                        setOrganismQuantityType(e.target.value);
                        setIsDirty(true);
                      }}
                    >
                      {ORGANISM_QUANTITY_TYPES.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>

                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="Notes (optional)"
                  value={occurrenceRemarks}
                  onChange={(e) => {
                    setOccurrenceRemarks(e.target.value);
                    setIsDirty(true);
                  }}
                  margin="normal"
                  placeholder="e.g. worn wings, feeding on milkweed along the creek trail"
                  helperText="Shared publicly as Darwin Core occurrence remarks."
                  slotProps={{ htmlInput: { maxLength: MAX_REMARK_LENGTH } }}
                />

                <ExternalRecordsField
                  records={externalRecords}
                  onChange={(records) => {
                    setExternalRecords(records);
                    setIsDirty(true);
                  }}
                  lockedUri={crosspostStatus.data?.inatUrl}
                />

                {offerCrosspost && (
                  <Box sx={{ mt: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={crosspost}
                          disabled={alreadyOnInat}
                          onChange={(_, checked) => {
                            setCrosspostChoice(checked);
                            setIsDirty(true);
                          }}
                        />
                      }
                      label="Also post to iNaturalist"
                    />
                    {alreadyOnInat && (
                      <Typography
                        variant="caption"
                        sx={{ display: "block", color: "text.secondary" }}
                      >
                        Already on iNaturalist: it links to an observation there.
                      </Typography>
                    )}
                  </Box>
                )}

                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <Button onClick={() => setActiveStep(STEP_IDENTIFY)} color="inherit" size="small">
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    disabled={isSubmitting}
                    startIcon={isSubmitting ? <ButtonSpinner /> : undefined}
                  >
                    {isSubmitting
                      ? isEditMode
                        ? "Saving..."
                        : "Submitting..."
                      : isEditMode
                        ? "Save Changes"
                        : "Submit"}
                  </Button>
                </Stack>
              </StepContent>
            </Step>
          </Stepper>

          {/* Persistent footer so submit/cancel are reachable from any step. */}
          {activeStep !== LAST_STEP && (
            <Stack
              direction="row"
              spacing={1}
              sx={{
                justifyContent: "flex-end",
                mt: 2,
                pt: 2,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              <Button onClick={handleRequestClose} color="inherit">
                Cancel
              </Button>
              <Button type="submit" variant="contained" color="primary" disabled={isSubmitting}>
                {isEditMode ? "Save Changes" : "Submit"}
              </Button>
            </Stack>
          )}
        </form>
      </ModalOverlay>
      <ConfirmDialog
        open={discardConfirmOpen}
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={handleConfirmDiscard}
        title="Discard changes?"
        message="You have unsaved changes. If you close now, your in-progress data will be lost."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        destructive
      />
      <PhotoLightbox
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        src={lightbox?.src ?? ""}
        alt={lightbox?.alt}
      />
    </>
  );
}
