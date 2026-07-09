import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import PlaceIcon from "@mui/icons-material/Place";
import { useLiveId } from "../../hooks/useLiveId";
import { useAppDispatch } from "../../store";
import { openUploadModal, setPendingUploadFiles, addToast } from "../../store/uiSlice";

/**
 * Full-screen live camera identifier — point the camera at something and the
 * top species guess updates continuously (Seek-style), backed by the same
 * `/api/species-id` endpoint the upload flow uses. Web/PWA only for now; it
 * relies on `getUserMedia` rather than the native Capacitor camera.
 */
export function LiveIdView() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // Location is a hard requirement: it drives the geo range filtering, so the
  // camera doesn't start until it's granted (rather than best-effort).
  const [locationState, setLocationState] = useState<"prompting" | "granted" | "denied">(
    "prompting",
  );

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationState("denied");
      return;
    }
    setLocationState("prompting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocationState("granted");
      },
      () => setLocationState("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  // Ask for location up front, before the camera or any identification starts.
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // Acquire the rear camera only once location is granted. Cleanup stops every
  // track so the camera light goes off the moment we leave the view.
  useEffect(() => {
    if (locationState !== "granted") return;
    let stream: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      // Request a high-res stream so the full-screen preview stays sharp (a
      // default ~640x480 stream upscaled to fill a phone screen looks blurry,
      // which is easily mistaken for the camera failing to focus). `ideal` so
      // it degrades gracefully on devices that can't deliver 1080p. Note this
      // only affects the preview and the shutter-captured photo — each live
      // inference frame is downscaled to 384px before upload regardless.
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        streamRef.current = s;
        // Surface the resolution we actually negotiated — handy for diagnosing
        // a soft preview (the browser may hand back less than requested).
        const settings = s.getVideoTracks()[0]?.getSettings();
        console.info(`[LiveId] camera resolution: ${settings?.width}x${settings?.height}`);
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play();
        }
      })
      .catch(() => {
        if (!cancelled) setError("Camera access is required for live identification.");
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [locationState]);

  const { suggestions, isInferring } = useLiveId({
    videoRef,
    active: ready,
    latitude: coords?.latitude,
    longitude: coords?.longitude,
  });

  const handleClose = () => navigate(-1);

  // Capture the current frame at native resolution and hand it to the existing
  // upload flow — the upload modal will re-run a full identification on it.
  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          dispatch(addToast({ message: "Couldn't capture photo", type: "error" }));
          return;
        }
        const file = new File([blob], `live-${Date.now()}.jpg`, { type: "image/jpeg" });
        setPendingUploadFiles([file]);
        dispatch(openUploadModal());
        navigate("/");
      },
      "image/jpeg",
      0.92,
    );
  };

  const sorted = [...suggestions].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  const rest = sorted.slice(1);

  // Location gate — the camera never starts until we have coordinates.
  if (locationState !== "granted") {
    return (
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          zIndex: 1300,
          bgcolor: "common.black",
          color: "common.white",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 2,
          p: 3,
        }}
      >
        <IconButton
          onClick={handleClose}
          aria-label="Close"
          sx={{ position: "absolute", top: 8, left: 8, color: "common.white" }}
        >
          <CloseIcon />
        </IconButton>
        <PlaceIcon sx={{ fontSize: 48, opacity: 0.85 }} />
        {locationState === "prompting" ? (
          <>
            <Typography variant="h6">Allow location access</Typography>
            <Typography variant="body2" sx={{ opacity: 0.8, maxWidth: 320 }}>
              Live identification uses your location to narrow suggestions to species found near
              you. Allow location access to continue.
            </Typography>
            <CircularProgress size={20} sx={{ color: "common.white", mt: 1 }} />
          </>
        ) : (
          <>
            <Typography variant="h6">Location required</Typography>
            <Typography variant="body2" sx={{ opacity: 0.8, maxWidth: 320 }}>
              Live identification needs your location. Enable location access for this site in your
              browser settings, then try again.
            </Typography>
            <Button variant="contained" color="primary" onClick={requestLocation} sx={{ mt: 1 }}>
              Try again
            </Button>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ position: "fixed", inset: 0, zIndex: 1300, bgcolor: "common.black" }}>
      <Box
        component="video"
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onPlaying={() => setReady(true)}
        sx={{ width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* Top gradient + close button */}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          p: 1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: theme.palette.overlay["gradientTop"],
        }}
      >
        <IconButton onClick={handleClose} sx={{ color: "common.white" }} aria-label="Close">
          <CloseIcon />
        </IconButton>
        {isInferring && <CircularProgress size={18} sx={{ color: "common.white", mr: 1 }} />}
      </Box>

      {error && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 3,
            textAlign: "center",
          }}
        >
          <Typography sx={{ color: "common.white" }}>{error}</Typography>
        </Box>
      )}

      {/* Bottom overlay: current best guess + shutter */}
      <Box
        sx={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          pt: 6,
          pb: 3,
          px: 2,
          background: theme.palette.overlay["gradientBottom"],
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Box sx={{ minHeight: 56, textAlign: "center", color: "common.white" }}>
          {top ? (
            <>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "baseline", justifyContent: "center", flexWrap: "wrap" }}
              >
                <Typography sx={{ fontStyle: "italic", fontWeight: 600 }}>
                  {top.scientificName}
                </Typography>
                {top.inRange === true && (
                  <PlaceIcon sx={{ fontSize: 16, color: "success.light" }} aria-label="In range" />
                )}
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {Math.round(top.confidence * 100)}%
                </Typography>
              </Stack>
              {top.commonName && (
                <Typography variant="body2" sx={{ opacity: 0.85 }}>
                  {top.commonName}
                </Typography>
              )}
              {rest.length > 0 && (
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  also: {rest.map((s) => s.commonName ?? s.scientificName).join(", ")}
                </Typography>
              )}
            </>
          ) : (
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {ready ? "Point at a plant or animal…" : "Starting camera…"}
            </Typography>
          )}
        </Box>

        <IconButton
          onClick={handleCapture}
          aria-label="Capture photo"
          sx={{
            width: 68,
            height: 68,
            bgcolor: "common.white",
            color: "common.black",
            border: `4px solid ${theme.palette.overlay["captureRing"]}`,
            "&:hover": { bgcolor: "common.white" },
          }}
        >
          <CameraAltIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
