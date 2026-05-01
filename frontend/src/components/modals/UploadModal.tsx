import { useState, useEffect, type FormEvent, type ChangeEvent, useRef } from "react";
import {
  Avatar,
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  Stack,
  IconButton,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import ExifReader from "exifreader";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeUploadModal, addToast, consumePendingUploadFiles } from "../../store/uiSlice";
import { submitObservation, updateObservation, pollObservation } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { ModalOverlay } from "./ModalOverlay";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { AiSuggestions } from "../identification/AiSuggestions";
import { LocationPicker } from "../map/LocationPicker";
import { getObservationUrl, getErrorMessage } from "../../lib/utils";
import { KINGDOMS } from "../../lib/kingdoms";
import { TAXON_RANKS } from "../../lib/taxonRanks";

interface ImagePreview {
  file: File;
  preview: string;
}

const LICENSE_OPTIONS = [
  { value: "CC0-1.0", label: "CC0 (Public Domain)" },
  { value: "CC-BY-4.0", label: "CC BY (Attribution)" },
  { value: "CC-BY-NC-4.0", label: "CC BY-NC (Attribution, Non-Commercial)" },
  { value: "CC-BY-SA-4.0", label: "CC BY-SA (Attribution, Share-Alike)" },
  {
    value: "CC-BY-NC-SA-4.0",
    label: "CC BY-NC-SA (Attribution, Non-Commercial, Share-Alike)",
  },
];

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function UploadModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.uploadModalOpen);
  const editingObservation = useAppSelector((state) => state.ui.editingObservation);
  const user = useAppSelector((state) => state.auth.user);
  const currentLocation = useAppSelector((state) => state.ui.currentLocation);

  const isEditMode = !!editingObservation;

  const [species, setSpecies] = useState("");
  const [matchedTaxon, setMatchedTaxon] = useState<TaxaResult | null>(null);
  const [kingdom, setKingdom] = useState("");
  const [rank, setRank] = useState("");
  const [license, setLicense] = useState("CC-BY-4.0");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [observationDate, setObservationDate] = useState(() => toDatetimeLocal(new Date()));
  const [uncertaintyMeters, setUncertaintyMeters] = useState(50);
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_IMAGES = 10;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"];

  useEffect(() => {
    if (isOpen) {
      if (editingObservation) {
        setSpecies(editingObservation.effectiveTaxonomy?.scientificName || "");
        setKingdom(editingObservation.effectiveTaxonomy?.kingdom || "");
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
        setExistingImages(editingObservation.images || []);
      } else {
        if (currentLocation) {
          setLat(currentLocation.lat.toFixed(6));
          setLng(currentLocation.lng.toFixed(6));
        }
        const pending = consumePendingUploadFiles();
        if (pending.length > 0) {
          addFiles(pending);
        }
      }
    }
  }, [isOpen, currentLocation, editingObservation]);

  const handleClose = () => {
    dispatch(closeUploadModal());
    setSpecies("");
    setMatchedTaxon(null);
    setKingdom("");
    setRank("");
    setLicense("CC-BY-4.0");
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
    setExistingImages([]);
    setObservationDate(toDatetimeLocal(new Date()));
    setUncertaintyMeters(50);
    setAiImageUrl(null);
  };

  const addFiles = (files: File[]) => {
    for (const file of files) {
      if (!VALID_TYPES.includes(file.type)) {
        dispatch(
          addToast({
            message: `Invalid file type: ${file.name}. Use JPG, PNG, or WebP.`,
            type: "error",
          }),
        );
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        dispatch(
          addToast({
            message: `File too large: ${file.name}. Max size is 10MB.`,
            type: "error",
          }),
        );
        continue;
      }

      if (images.length >= MAX_IMAGES) {
        dispatch(
          addToast({
            message: `Maximum ${MAX_IMAGES} images allowed.`,
            type: "error",
          }),
        );
        break;
      }

      const preview = URL.createObjectURL(file);
      setImages((prev) => [...prev, { file, preview }]);

      if (images.length === 0) {
        extractExifData(file);
        if (!species && !isEditMode) {
          setAiImageUrl(preview);
        }
      }
    }
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const extractExifData = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const tags = ExifReader.load(arrayBuffer);

      // Extract GPS coordinates
      const gpsLat = tags.GPSLatitude;
      const gpsLng = tags.GPSLongitude;
      const latRef = tags.GPSLatitudeRef;
      const lngRef = tags.GPSLongitudeRef;

      if (gpsLat && gpsLng) {
        // description may be a number or string depending on browser/ExifReader version
        let latitude =
          typeof gpsLat.description === "number"
            ? gpsLat.description
            : parseFloat(String(gpsLat.description));
        let longitude =
          typeof gpsLng.description === "number"
            ? gpsLng.description
            : parseFloat(String(gpsLng.description));

        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          // Apply hemisphere signs
          const latRefValue = Array.isArray(latRef?.value) ? latRef.value[0] : undefined;
          const lngRefValue = Array.isArray(lngRef?.value) ? lngRef.value[0] : undefined;
          if (latRefValue === "S") latitude = -Math.abs(latitude);
          if (lngRefValue === "W") longitude = -Math.abs(longitude);

          setLat(latitude.toFixed(6));
          setLng(longitude.toFixed(6));
          dispatch(
            addToast({
              message: "Location extracted from photo EXIF data",
              type: "success",
            }),
          );
        }
      }

      // Extract date taken
      const dateOriginal = tags.DateTimeOriginal || tags.DateTime;
      if (dateOriginal?.description) {
        // EXIF date format: "YYYY:MM:DD HH:MM:SS"
        const dateStr = dateOriginal.description;
        const parsed = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
        const date = new Date(parsed);
        if (!isNaN(date.getTime())) {
          setObservationDate(toDatetimeLocal(date));
          dispatch(
            addToast({
              message: "Date extracted from photo EXIF data",
              type: "success",
            }),
          );
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
  };

  const handleRemoveExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // On update the URI is stable, so matching on CID is required to
  // distinguish the ingester's new row from the pre-update one.
  const waitForObservation = (uri: string, targetCid: string) =>
    pollObservation(uri, (r) => r?.occurrence?.cid === targetCid);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!lat || !lng) {
      dispatch(addToast({ message: "Please provide a location", type: "error" }));
      return;
    }

    const trimmedSpecies = species.trim();
    if (trimmedSpecies && !matchedTaxon && !kingdom) {
      dispatch(
        addToast({
          message: "Please select a kingdom for the taxon name you entered",
          type: "error",
        }),
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const imageData = await Promise.all(
        images.map(async (img) => ({
          data: await fileToBase64(img.file),
          mimeType: img.file.type,
        })),
      );

      let observationUri: string;

      if (isEditMode && editingObservation) {
        // Extract CIDs from retained existing image URLs (/media/blob/{did}/{cid})
        const retainedBlobCids = existingImages.map((url) => {
          return url.split("/").at(-1) ?? "";
        });

        const result = await updateObservation({
          uri: editingObservation.uri,
          ...(trimmedSpecies ? { scientificName: trimmedSpecies } : {}),
          ...(trimmedSpecies && kingdom ? { kingdom } : {}),
          ...(trimmedSpecies && !matchedTaxon && rank ? { taxonRank: rank } : {}),
          latitude: parseFloat(lat),
          longitude: parseFloat(lng),
          coordinateUncertaintyInMeters: uncertaintyMeters,
          license,
          eventDate: new Date(observationDate).toISOString(),
          ...(imageData.length > 0 ? { images: imageData } : {}),
          retainedBlobCids,
        });

        // Wait for the ingester to refresh the row to the new CID
        await waitForObservation(result.uri, result.cid);
        observationUri = result.uri;

        dispatch(
          addToast({
            message: "Observation updated successfully!",
            type: "success",
          }),
        );
      } else {
        const eventDate = new Date(observationDate).toISOString();

        const result = await submitObservation({
          ...(trimmedSpecies ? { scientificName: trimmedSpecies } : {}),
          ...(trimmedSpecies && kingdom ? { kingdom } : {}),
          ...(trimmedSpecies && !matchedTaxon && rank ? { taxonRank: rank } : {}),
          latitude: parseFloat(lat),
          longitude: parseFloat(lng),
          coordinateUncertaintyInMeters: uncertaintyMeters,
          license,
          eventDate,
          ...(imageData.length > 0 ? { images: imageData } : {}),
        });

        // Wait for the observation to be processed by the ingester
        const processed = await waitForObservation(result.uri, result.cid);
        observationUri = result.uri;

        dispatch(
          addToast({
            message: processed
              ? "Observation submitted successfully!"
              : "Observation submitted! It may take a moment to appear.",
            type: "success",
          }),
        );
      }

      // Navigate to the observation page
      window.location.href = getObservationUrl(observationUri);
    } catch (error) {
      dispatch(
        addToast({
          message: `Failed to ${isEditMode ? "update" : "submit"}: ${getErrorMessage(error)}`,
          type: "error",
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Expected string result"));
          return;
        }
        const base64 = reader.result.split(",")[1];
        if (!base64) {
          reject(new Error("Invalid data URL format"));
          return;
        }
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleLocationChange = (newLat: number, newLng: number) => {
    setLat(newLat.toFixed(6));
    setLng(newLng.toFixed(6));
  };

  return (
    <ModalOverlay isOpen={isOpen} onClose={handleClose}>
      {user && (
        <Alert severity="success" sx={{ mb: 2, mx: -1, mt: -1 }}>
          Posting as {user.handle ? `@${user.handle}` : user.did}
        </Alert>
      )}
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
          ref={fileInputRef}
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
                <Box
                  component="img"
                  src={url}
                  alt={`Existing ${index + 1}`}
                  sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
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
                <Box
                  component="img"
                  src={img.preview}
                  alt={`Preview ${index + 1}`}
                  sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
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

        <LocationPicker
          latitude={lat ? parseFloat(lat) : null}
          longitude={lng ? parseFloat(lng) : null}
          onChange={handleLocationChange}
          uncertaintyMeters={uncertaintyMeters}
          onUncertaintyChange={setUncertaintyMeters}
        />

        <TaxaAutocomplete
          value={species}
          onChange={(name) => {
            setSpecies(name);
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
            ) : aiImageUrl ? (
              <AiSuggestions
                imageUrl={aiImageUrl}
                latitude={lat ? parseFloat(lat) : undefined}
                longitude={lng ? parseFloat(lng) : undefined}
                onSelect={(s) => {
                  setSpecies(s.scientificName);
                  if (s.taxonMatch) {
                    setMatchedTaxon(s.taxonMatch);
                    setKingdom(s.taxonMatch.kingdom ?? "");
                    setRank("");
                  } else if (s.kingdom) {
                    setKingdom(s.kingdom);
                  }
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
              onChange={(e) => setKingdom(e.target.value)}
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
              onChange={(e) => setRank(e.target.value)}
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
            onChange={(e) => setLicense(e.target.value)}
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
          onChange={(e) => setObservationDate(e.target.value)}
          margin="normal"
          slotProps={{
            inputLabel: { shrink: true },
          }}
        />

        <Stack
          direction="row"
          spacing={1}
          sx={{
            justifyContent: "flex-end",
            mt: 2,
          }}
        >
          <Button onClick={handleClose} color="inherit">
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
  );
}
