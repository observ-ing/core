// Phone layout, before any photos: what the tool does and the way in.
import { Alert, AlertTitle, Box, Button, CircularProgress, Typography } from "@mui/material";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import { MAX_BATCH_PHOTOS } from "../../../lib/batchUpload";
import { formatMegabytes } from "../../../lib/imageSelection";
import { useMaxPhotoSize } from "../../../lib/query/hooks";
import { plural } from "../../../lib/utils";

export interface PhoneStartProps {
  onChoosePhotos: () => void;
  /** HEIC photos already picked and still being converted. */
  converting: number;
  /**
   * This browser hands over picked photos without their GPS position, as
   * Android browsers do, so every location will have to be set by hand.
   */
  stripsLocation: boolean;
}

export function PhoneStart({ onChoosePhotos, converting, stripsLocation }: PhoneStartProps) {
  const maxPhotoSize = useMaxPhotoSize();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, px: 2, py: 3 }}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
          Batch upload
        </Typography>
        <Typography sx={{ color: "text.secondary" }}>
          Add many observations at once. Each photo starts as its own observation. Combine the ones
          that show the same organism.
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          px: 2.5,
          py: 5,
          border: 2,
          borderStyle: "dashed",
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
          textAlign: "center",
        }}
      >
        <PhotoLibraryIcon color="primary" sx={{ fontSize: 48 }} />
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<PhotoLibraryIcon />}
          onClick={onChoosePhotos}
          sx={{ minHeight: 52 }}
        >
          Choose photos
        </Button>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          JPEG, PNG, WebP, or HEIC. {formatMegabytes(maxPhotoSize.bytes)} each
          {maxPhotoSize.limitedByPds && " (set by your PDS)"}, up to {MAX_BATCH_PHOTOS} photos per
          batch.
        </Typography>
        {converting > 0 && (
          <Typography
            role="status"
            sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}
          >
            <CircularProgress size={16} color="inherit" />
            Converting {plural(converting, "HEIC photo")}…
          </Typography>
        )}
      </Box>
      {stripsLocation && (
        <Alert severity="warning" variant="outlined">
          <AlertTitle>This browser removes location from photos</AlertTitle>
          Photos picked here arrive without GPS, so their locations need setting by hand.
        </Alert>
      )}
    </Box>
  );
}
