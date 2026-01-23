import {
  useState,
  useEffect,
  FormEvent,
  useCallback,
  useRef,
  ChangeEvent,
} from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  Stack,
  IconButton,
  Alert,
  Autocomplete,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeUploadModal, addToast } from "../../store/uiSlice";
import { resetFeed, loadInitialFeed } from "../../store/feedSlice";
import {
  submitOccurrence,
  updateOccurrence,
  searchTaxa,
} from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { ModalOverlay } from "./ModalOverlay";
import { ConservationStatus } from "../common/ConservationStatus";
import { LocationPicker } from "../map/LocationPicker";

interface ImagePreview {
  file: File;
  preview: string;
}

const QUICK_SPECIES = [
  { name: "Eschscholzia californica", label: "California Poppy" },
  { name: "Quercus agrifolia", label: "Coast Live Oak" },
  { name: "Columba livia", label: "Rock Dove" },
  { name: "Sciurus griseus", label: "Western Gray Squirrel" },
];

export function UploadModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.uploadModalOpen);
  const editingOccurrence = useAppSelector(
    (state) => state.ui.editingOccurrence
  );
  const user = useAppSelector((state) => state.auth.user);
  const currentLocation = useAppSelector((state) => state.ui.currentLocation);

  const isEditMode = !!editingOccurrence;

  const [species, setSpecies] = useState("");
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [suggestions, setSuggestions] = useState<TaxaResult[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [images, setImages] = useState<ImagePreview[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_IMAGES = 10;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"];

  useEffect(() => {
    if (isOpen) {
      if (editingOccurrence) {
        setSpecies(editingOccurrence.scientificName || "");
        setNotes(editingOccurrence.occurrenceRemarks || "");
        if (editingOccurrence.location) {
          setLat(editingOccurrence.location.lat.toFixed(6));
          setLng(editingOccurrence.location.lng.toFixed(6));
        }
      } else if (currentLocation) {
        setLat(currentLocation.lat.toFixed(6));
        setLng(currentLocation.lng.toFixed(6));
      } else {
        navigator.geolocation?.getCurrentPosition(
          (position) => {
            setLat(position.coords.latitude.toFixed(6));
            setLng(position.coords.longitude.toFixed(6));
          },
          () => {
            setLat("37.7749");
            setLng("-122.4194");
          }
        );
      }
    }
  }, [isOpen, currentLocation, editingOccurrence]);

  const handleClose = () => {
    dispatch(closeUploadModal());
    setSpecies("");
    setNotes("");
    setSuggestions([]);
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    for (const file of files) {
      if (!VALID_TYPES.includes(file.type)) {
        dispatch(
          addToast({
            message: `Invalid file type: ${file.name}. Use JPG, PNG, or WebP.`,
            type: "error",
          })
        );
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        dispatch(
          addToast({
            message: `File too large: ${file.name}. Max size is 10MB.`,
            type: "error",
          })
        );
        continue;
      }

      if (images.length >= MAX_IMAGES) {
        dispatch(
          addToast({
            message: `Maximum ${MAX_IMAGES} images allowed.`,
            type: "error",
          })
        );
        break;
      }

      const preview = URL.createObjectURL(file);
      setImages((prev) => [...prev, { file, preview }]);

      if (images.length === 0 && !lat && !lng) {
        extractExifLocation(file);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const extractExifLocation = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const dataView = new DataView(arrayBuffer);
      if (dataView.getUint16(0) !== 0xffd8) return;
    } catch (error) {
      console.error("EXIF extraction error:", error);
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleSpeciesSearch = useCallback(async (value: string) => {
    if (value.length >= 2) {
      const results = await searchTaxa(value);
      setSuggestions(results.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, []);

  const handleQuickSpecies = (name: string) => {
    setSpecies(name);
    setSuggestions([]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!lat || !lng) {
      dispatch(
        addToast({ message: "Please provide a location", type: "error" })
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const imageData: Array<{ data: string; mimeType: string }> = [];
      for (const img of images) {
        const base64 = await fileToBase64(img.file);
        imageData.push({
          data: base64,
          mimeType: img.file.type,
        });
      }

      if (isEditMode && editingOccurrence) {
        await updateOccurrence({
          uri: editingOccurrence.uri,
          scientificName: species || "Unknown species",
          latitude: parseFloat(lat),
          longitude: parseFloat(lng),
          notes: notes || undefined,
          eventDate: editingOccurrence.eventDate || new Date().toISOString(),
        });
        dispatch(
          addToast({
            message: "Occurrence updated successfully!",
            type: "success",
          })
        );
      } else {
        await submitOccurrence({
          scientificName: species || "Unknown species",
          latitude: parseFloat(lat),
          longitude: parseFloat(lng),
          notes: notes || undefined,
          eventDate: new Date().toISOString(),
          images: imageData.length > 0 ? imageData : undefined,
        });
        dispatch(
          addToast({
            message: "Occurrence submitted successfully!",
            type: "success",
          })
        );
      }

      handleClose();
      dispatch(resetFeed());
      dispatch(loadInitialFeed());
    } catch (error) {
      dispatch(
        addToast({
          message: `Failed to ${isEditMode ? "update" : "submit"}: ${error instanceof Error ? error.message : "Unknown error"}`,
          type: "error",
        })
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
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
        {isEditMode ? "Edit Occurrence" : "New Occurrence"}
      </Typography>

      <form onSubmit={handleSubmit}>
        <Autocomplete
          freeSolo
          options={suggestions}
          getOptionLabel={(option) =>
            typeof option === "string" ? option : option.scientificName
          }
          inputValue={species}
          onInputChange={(_, value) => {
            setSpecies(value);
            handleSpeciesSearch(value);
          }}
          onChange={(_, value) => {
            if (value) {
              const name = typeof value === "string" ? value : value.scientificName;
              setSpecies(name);
              setSuggestions([]);
            }
          }}
          filterOptions={(x) => x}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              label="Species"
              placeholder="e.g. Eschscholzia californica"
              margin="normal"
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box
                component="li"
                key={key}
                {...otherProps}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  p: 1.5,
                }}
              >
                {option.photoUrl && (
                  <Box
                    component="img"
                    src={option.photoUrl}
                    alt=""
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      objectFit: "cover",
                      flexShrink: 0,
                    }}
                  />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={600}>{option.scientificName}</Typography>
                    {option.conservationStatus && (
                      <ConservationStatus status={option.conservationStatus} size="sm" />
                    )}
                  </Stack>
                  {option.commonName && (
                    <Typography variant="caption" color="text.disabled">
                      {option.commonName}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          }}
        />

        <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
          {QUICK_SPECIES.map((s) => (
            <Chip
              key={s.name}
              label={s.label}
              size="small"
              onClick={() => handleQuickSpecies(s.name)}
              sx={{
                cursor: "pointer",
                "&:hover": {
                  borderColor: "primary.main",
                  bgcolor: "background.paper",
                },
              }}
              variant="outlined"
            />
          ))}
        </Stack>

        <TextField
          fullWidth
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe what you observed..."
          multiline
          rows={2}
          margin="normal"
        />

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 1 }}>
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

        {images.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
            {images.map((img, index) => (
              <Box
                key={index}
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

        {images.length < MAX_IMAGES && (
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

        <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
          JPG, PNG, or WebP - Max 10MB each - Up to {MAX_IMAGES} photos
        </Typography>

        {lat && lng && (
          <LocationPicker
            latitude={parseFloat(lat)}
            longitude={parseFloat(lng)}
            onChange={handleLocationChange}
          />
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button onClick={handleClose} color="inherit">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={isSubmitting}
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
