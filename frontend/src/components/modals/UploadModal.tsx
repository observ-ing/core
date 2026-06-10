import { lazy, Suspense, useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import {
  Avatar,
  Box,
  ButtonBase,
  Typography,
  TextField,
  Button,
  Chip,
  Stack,
  IconButton,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import ExifReader from "exifreader";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeUploadModal, consumePendingUploadFiles } from "../../store/uiSlice";
import { trackSubmission } from "../../store/pendingSlice";
import { useToast } from "../../hooks/useToast";
import { useUserPreferences } from "../../lib/query/hooks";
import { useSubmitObservation, useUpdateObservation } from "../../lib/query/mutations";
import { validateTaxon } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { ModalOverlay } from "./ModalOverlay";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { VisualId } from "../identification/VisualId";
import { PhotoLightbox } from "../observation/PhotoLightbox";
import { getErrorMessage, fileToBase64 } from "../../lib/utils";
import { KINGDOMS } from "../../lib/kingdoms";
import { TAXON_RANKS } from "../../lib/taxonRanks";
import { pickPhotos } from "../../lib/photoPicker";
import { LICENSE_OPTIONS, DEFAULT_LICENSE } from "../../lib/licenses";

// Lazy so maplibre-gl (heavy) is split into its own chunk, loaded only when the
// upload modal actually opens (the MUI Dialog doesn't mount children until then).
const LocationPicker = lazy(() =>
  import("../map/LocationPicker").then((m) => ({ default: m.LocationPicker })),
);

interface ImagePreview {
  file: File;
  preview: string;
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Darwin Core dwc:organismQuantityType values the backend lexicon recognizes.
// "individuals" is the default for a plain count; the observation view renders
// the chosen type next to the number (e.g. "12 (individuals)").
const ORGANISM_QUANTITY_TYPES = [
  { value: "individuals", label: "Individuals" },
  { value: "percent-cover", label: "Percent cover" },
] as const;
const DEFAULT_ORGANISM_QUANTITY_TYPE = "individuals";

export function UploadModal() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const isOpen = useAppSelector((state) => state.ui.uploadModalOpen);
  const editingObservation = useAppSelector((state) => state.ui.editingObservation);
  const defaultLicense = useUserPreferences().data?.defaultLicense ?? null;
  const currentLocation = useAppSelector((state) => state.ui.currentLocation);

  const isEditMode = !!editingObservation;

  const submitObs = useSubmitObservation();
  const updateObs = useUpdateObservation();
  const isSubmitting = submitObs.isPending || updateObs.isPending;

  const [species, setSpecies] = useState("");
  const [matchedTaxon, setMatchedTaxon] = useState<TaxaResult | null>(null);
  const [kingdom, setKingdom] = useState("");
  const [rank, setRank] = useState("");
  const [license, setLicense] = useState<string>(DEFAULT_LICENSE);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [observationDate, setObservationDate] = useState(() => toDatetimeLocal(new Date()));
  const [uncertaintyMeters, setUncertaintyMeters] = useState(50);
  // Darwin Core organismQuantity (+ its type). Kept out of the default flow in a
  // collapsed "More details" section — most users identifying a single organism
  // never touch it.
  const [organismQuantity, setOrganismQuantity] = useState("");
  const [organismQuantityType, setOrganismQuantityType] = useState<string>(
    DEFAULT_ORGANISM_QUANTITY_TYPE,
  );
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [visualIdImageUrl, setVisualIdImageUrl] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const MAX_IMAGES = 10;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"];

  useEffect(() => {
    if (!isOpen) return undefined;
    setIsDirty(false);
    setOrganismQuantity("");
    setOrganismQuantityType(DEFAULT_ORGANISM_QUANTITY_TYPE);
    setMoreDetailsOpen(false);
    if (!editingObservation) {
      setLicense(defaultLicense ?? DEFAULT_LICENSE);
      if (currentLocation) {
        setLat(currentLocation.lat.toFixed(6));
        setLng(currentLocation.lng.toFixed(6));
      }
      const pending = consumePendingUploadFiles();
      if (pending.length > 0) {
        addFiles(pending);
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
      setObservationDate(toDatetimeLocal(new Date(editingObservation.eventDate)));
    }
    if (editingObservation.location) {
      setLat(editingObservation.location.latitude.toFixed(6));
      setLng(editingObservation.location.longitude.toFixed(6));
      if (editingObservation.location.uncertaintyMeters) {
        setUncertaintyMeters(editingObservation.location.uncertaintyMeters);
      }
    }
    setExistingImages((editingObservation.images || []).map((img) => img.url));
    // Pre-fill quantity and expand the section so an existing value is visible
    // (and not silently wiped) when editing.
    if (editingObservation.organismQuantity) {
      setOrganismQuantity(editingObservation.organismQuantity);
      setOrganismQuantityType(
        editingObservation.organismQuantityType || DEFAULT_ORGANISM_QUANTITY_TYPE,
      );
      setMoreDetailsOpen(true);
    }

    // Resolve the existing taxon name back to a TaxaResult so the form
    // shows "Existing taxon" instead of incorrectly flagging it as new.
    if (!existingName) return undefined;
    const controller = new AbortController();
    validateTaxon(existingName, existingKingdom || undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result?.valid && result.taxon) {
          setMatchedTaxon(result.taxon);
        }
      })
      .catch(() => {
        // Silent — fetch was aborted or failed; the unmatched-name UI is the
        // safe default.
      });
    return () => controller.abort();
  }, [isOpen, currentLocation, editingObservation, defaultLicense]);

  const resetForm = () => {
    setSpecies("");
    setMatchedTaxon(null);
    setKingdom("");
    setRank("");
    setLicense(isEditMode ? DEFAULT_LICENSE : (defaultLicense ?? DEFAULT_LICENSE));
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
    setExistingImages([]);
    setObservationDate(toDatetimeLocal(new Date()));
    setUncertaintyMeters(50);
    setOrganismQuantity("");
    setOrganismQuantityType(DEFAULT_ORGANISM_QUANTITY_TYPE);
    setMoreDetailsOpen(false);
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

  const addFiles = (files: File[]) => {
    for (const file of files) {
      if (!VALID_TYPES.includes(file.type)) {
        toast.error(`Invalid file type: ${file.name}. Use JPG, PNG, or WebP.`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast.error(`File too large: ${file.name}. Max size is 10MB.`);
        continue;
      }

      if (images.length >= MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images allowed.`);
        break;
      }

      const preview = URL.createObjectURL(file);
      setImages((prev) => [...prev, { file, preview }]);
      setIsDirty(true);

      if (images.length === 0) {
        extractExifData(file);
        if (!species && !isEditMode) {
          setVisualIdImageUrl(preview);
        }
      }
    }
  };

  const handlePickImages = async () => {
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed.`);
      return;
    }
    const files = await pickPhotos({
      source: "gallery",
      multiple: true,
      maxCount: remaining,
    });
    if (files.length > 0) addFiles(files);
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const extractExifData = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const tags = ExifReader.load(arrayBuffer);

      const gpsLat = tags.GPSLatitude;
      const gpsLng = tags.GPSLongitude;
      const latRef = tags.GPSLatitudeRef;
      const lngRef = tags.GPSLongitudeRef;

      if (gpsLat && gpsLng) {
        let latitude =
          typeof gpsLat.description === "number"
            ? gpsLat.description
            : parseFloat(String(gpsLat.description));
        let longitude =
          typeof gpsLng.description === "number"
            ? gpsLng.description
            : parseFloat(String(gpsLng.description));

        // Reject (0, 0). Android's photo picker (and some other privacy-
        // scrubbed providers) returns the EXIF GPS *structure* with values
        // zeroed instead of removing the tags. A real observation at the
        // null island is so unlikely that treating zero as "missing" is safe.
        const isZeroIsland = latitude === 0 && longitude === 0;
        if (Number.isFinite(latitude) && Number.isFinite(longitude) && !isZeroIsland) {
          const latRefValue = Array.isArray(latRef?.value) ? latRef.value[0] : undefined;
          const lngRefValue = Array.isArray(lngRef?.value) ? lngRef.value[0] : undefined;
          if (latRefValue === "S") latitude = -Math.abs(latitude);
          if (lngRefValue === "W") longitude = -Math.abs(longitude);

          setLat(latitude.toFixed(6));
          setLng(longitude.toFixed(6));
          toast.success("Location extracted from photo EXIF data");
        }
      }

      const dateOriginal = tags.DateTimeOriginal || tags.DateTime;
      if (dateOriginal?.description) {
        // EXIF date format: "YYYY:MM:DD HH:MM:SS"
        const dateStr = dateOriginal.description;
        const parsed = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
        const date = new Date(parsed);
        if (!isNaN(date.getTime())) {
          setObservationDate(toDatetimeLocal(date));
          toast.success("Date extracted from photo EXIF data");
        }
      }
    } catch (error) {
      console.error("EXIF extraction error:", error);
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
    setIsDirty(true);
  };

  const handleRemoveExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  };

  const handleUploadClick = () => {
    void handlePickImages();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!lat || !lng) {
      toast.error("Please provide a location");
      return;
    }

    const trimmedSpecies = species.trim();
    if (trimmedSpecies && !matchedTaxon && !kingdom) {
      toast.error("Please select a kingdom for the taxon name you entered");
      return;
    }

    const imageData = await Promise.all(
      images.map(async (img) => ({
        data: await fileToBase64(img.file),
        mimeType: img.file.type,
      })),
    );

    const kind: "create" | "update" = isEditMode ? "update" : "create";

    // The PDS write succeeded. Close the modal immediately so the submission
    // feels instant — the ingester poll, completion toast, and cache
    // invalidation run in the background (surfaced by the TopBar pending
    // indicator). The user stays on the current page; the new/updated row
    // appears in place once the ingester catches up.
    const onSuccess = (result: { uri: string; cid: string }) => {
      dispatch(closeUploadModal());
      resetForm();
      void dispatch(trackSubmission({ uri: result.uri, cid: result.cid, kind }));
    };
    const onError = (error: Error) => {
      toast.error(`Failed to ${isEditMode ? "update" : "submit"}: ${getErrorMessage(error)}`);
    };

    // Fields shared by create and update; the update path adds `uri` and
    // `retainedBlobCids` on top. Conditional spreads omit empty/unset values
    // so we never send blank taxonomy or quantity fields.
    const commonPayload = {
      ...(trimmedSpecies ? { scientificName: trimmedSpecies } : {}),
      ...(trimmedSpecies && kingdom ? { kingdom } : {}),
      ...(trimmedSpecies && !matchedTaxon && rank ? { taxonRank: rank } : {}),
      ...(trimmedSpecies && matchedTaxon?.taxonId ? { taxonId: matchedTaxon.taxonId } : {}),
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
      eventDate: new Date(observationDate).toISOString(),
      ...(imageData.length > 0 ? { images: imageData } : {}),
    };

    if (isEditMode && editingObservation) {
      // Extract CIDs from retained existing image URLs (/media/blob/{did}/{cid})
      const retainedBlobCids = existingImages.map((url) => {
        return url.split("/").at(-1) ?? "";
      });

      updateObs.mutate(
        { uri: editingObservation.uri, ...commonPayload, retainedBlobCids },
        { onSuccess, onError },
      );
    } else {
      submitObs.mutate(commonPayload, { onSuccess, onError });
    }
  };

  const handleLocationChange = (newLat: number, newLng: number) => {
    setLat(newLat.toFixed(6));
    setLng(newLng.toFixed(6));
    setIsDirty(true);
  };

  return (
    <>
      <ModalOverlay isOpen={isOpen} onClose={handleRequestClose}>
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
          {isEditMode ? "Edit Observation" : "New Observation"}
        </Typography>
        <form onSubmit={handleSubmit}>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 1,
            }}
          >
            Photos (optional)
          </Typography>

          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleImageSelect}
            style={{ display: "none" }}
          />

          {(existingImages.length > 0 || images.length > 0) && (
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
              {existingImages.map((url, index) => (
                <Box
                  key={`existing-${index}`}
                  sx={{
                    position: "relative",
                    width: 80,
                    height: 80,
                    borderRadius: 1,
                    overflow: "hidden",
                    border: 1,
                    borderColor: "divider",
                  }}
                >
                  <ButtonBase
                    onClick={() => setLightbox({ src: url, alt: `Existing ${index + 1}` })}
                    aria-label="Enlarge photo"
                    sx={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      cursor: "zoom-in",
                    }}
                  >
                    <Box
                      component="img"
                      src={url}
                      alt={`Existing ${index + 1}`}
                      sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </ButtonBase>
                  <IconButton
                    size="small"
                    onClick={() => handleRemoveExistingImage(index)}
                    aria-label="Remove image"
                    sx={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      bgcolor: "rgba(0, 0, 0, 0.7)",
                      color: "white",
                      width: 20,
                      height: 20,
                      "&:hover": { bgcolor: "error.main" },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
              {images.map((img, index) => (
                <Box
                  key={`new-${index}`}
                  sx={{
                    position: "relative",
                    width: 80,
                    height: 80,
                    borderRadius: 1,
                    overflow: "hidden",
                    border: 1,
                    borderColor: "divider",
                  }}
                >
                  <ButtonBase
                    onClick={() => setLightbox({ src: img.preview, alt: `Preview ${index + 1}` })}
                    aria-label="Enlarge photo"
                    sx={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      cursor: "zoom-in",
                    }}
                  >
                    <Box
                      component="img"
                      src={img.preview}
                      alt={`Preview ${index + 1}`}
                      sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </ButtonBase>
                  <IconButton
                    size="small"
                    onClick={() => handleRemoveImage(index)}
                    aria-label="Remove image"
                    sx={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      bgcolor: "rgba(0, 0, 0, 0.7)",
                      color: "white",
                      width: 20,
                      height: 20,
                      "&:hover": { bgcolor: "error.main" },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}

          {existingImages.length + images.length < MAX_IMAGES && (
            <Button
              fullWidth
              variant="outlined"
              onClick={handleUploadClick}
              startIcon={<AddPhotoAlternateIcon />}
              sx={{
                borderStyle: "dashed",
                color: "text.disabled",
                "&:hover": {
                  borderColor: "primary.main",
                  color: "primary.main",
                },
              }}
            >
              {images.length === 0 ? "Add photos" : "Add more photos"}
            </Button>
          )}

          <Typography
            variant="caption"
            sx={{
              color: "text.disabled",
              display: "block",
              mt: 0.5,
            }}
          >
            JPG, PNG, or WebP - Max 10MB each - Up to {MAX_IMAGES} photos
          </Typography>

          <Suspense
            fallback={
              <Box
                sx={{
                  height: 260,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CircularProgress size={24} />
              </Box>
            }
          >
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
                matchedTaxon ? (
                  <Chip
                    {...(matchedTaxon.photoUrl
                      ? { avatar: <Avatar src={matchedTaxon.photoUrl} alt="" /> }
                      : { icon: <CheckCircleOutlinedIcon /> })}
                    label={["Existing taxon", matchedTaxon.commonName, matchedTaxon.rank]
                      .filter((p): p is string => Boolean(p))
                      .join(" · ")}
                    color="success"
                    size="small"
                    variant="outlined"
                    sx={{ mt: 0.5 }}
                  />
                ) : (
                  <Chip
                    icon={<AddCircleOutlinedIcon />}
                    label="New taxon"
                    color="info"
                    size="small"
                    variant="outlined"
                    sx={{ mt: 0.5 }}
                  />
                )
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
            <FormControl fullWidth margin="normal" required>
              <InputLabel id="kingdom-label">Kingdom</InputLabel>
              <Select
                labelId="kingdom-label"
                value={kingdom}
                label="Kingdom"
                onChange={(e) => {
                  setKingdom(e.target.value);
                  setIsDirty(true);
                }}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {KINGDOMS.map((k) => (
                  <MenuItem key={k.value} value={k.value}>
                    {k.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {!!species.trim() && !matchedTaxon && (
            <FormControl fullWidth margin="normal">
              <InputLabel id="rank-label">Rank (optional)</InputLabel>
              <Select
                labelId="rank-label"
                value={rank}
                label="Rank (optional)"
                onChange={(e) => {
                  setRank(e.target.value);
                  setIsDirty(true);
                }}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {TAXON_RANKS.map((r) => (
                  <MenuItem key={r} value={r}>
                    {r}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl fullWidth margin="normal">
            <InputLabel id="license-label">License</InputLabel>
            <Select
              labelId="license-label"
              value={license}
              label="License"
              onChange={(e) => {
                setLicense(e.target.value);
                setIsDirty(true);
              }}
            >
              {LICENSE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            label="Observation date"
            type="datetime-local"
            value={observationDate}
            onChange={(e) => {
              setObservationDate(e.target.value);
              setIsDirty(true);
            }}
            margin="normal"
            slotProps={{
              inputLabel: { shrink: true },
            }}
          />

          <Accordion
            expanded={moreDetailsOpen}
            onChange={(_, expanded) => setMoreDetailsOpen(expanded)}
            disableGutters
            elevation={0}
            square
            sx={{
              mt: 1,
              bgcolor: "transparent",
              "&:before": { display: "none" },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: "auto" }}>
              <Typography variant="body2" color="text.secondary">
                More details (optional)
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0, pt: 0 }}>
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Quantity"
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
              <Typography variant="caption" color="text.secondary">
                How many organisms you observed. Optional — leave blank if unsure.
              </Typography>
            </AccordionDetails>
          </Accordion>

          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: "flex-end",
              mt: 2,
            }}
          >
            <Button onClick={handleRequestClose} color="inherit">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isSubmitting}
              startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
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
