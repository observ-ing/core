import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // Acquire the rear camera. Cleanup stops every track so the camera light
  // goes off the moment we leave the view.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        streamRef.current = s;
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
  }, []);

  // Best-effort location for the geo range boost; identification works without it.
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!cancelled) {
          setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <Box sx={{ position: "fixed", inset: 0, zIndex: 1300, bgcolor: "black" }}>
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
          background: "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)",
        }}
      >
        <IconButton onClick={handleClose} sx={{ color: "white" }} aria-label="Close">
          <CloseIcon />
        </IconButton>
        {isInferring && <CircularProgress size={18} sx={{ color: "white", mr: 1 }} />}
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
          <Typography sx={{ color: "white" }}>{error}</Typography>
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
          background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Box sx={{ minHeight: 56, textAlign: "center", color: "white" }}>
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
            bgcolor: "white",
            color: "black",
            border: "4px solid rgba(255,255,255,0.5)",
            "&:hover": { bgcolor: "white" },
          }}
        >
          <CameraAltIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
