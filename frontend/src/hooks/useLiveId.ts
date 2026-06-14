import { useEffect, useRef, useState } from "react";
import { identifySpecies, type SpeciesSuggestion } from "../services/api";

interface UseLiveIdOptions {
  /** The live preview element to sample frames from. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Run the loop only while true (e.g. once the stream is playing). */
  active: boolean;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

/**
 * Longest edge (px) of the JPEG we send per frame. The server resizes to
 * 224x224 anyway, so anything much larger just wastes bandwidth and inference
 * setup; ~384 keeps small subjects legible after downscale.
 */
const FRAME_MAX_EDGE = 384;
const FRAME_JPEG_QUALITY = 0.7;

/**
 * Minimum gap between the *end* of one inference and the *start* of the next.
 * We never have more than one request in flight (each is a full BioCLIP pass),
 * so the effective cadence is inference latency + this gap. Keeps server load
 * and battery bounded while still feeling responsive.
 */
const MIN_GAP_MS = 700;

/** How many candidates to show in the live overlay. */
const LIVE_LIMIT = 3;

function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const { videoWidth, videoHeight } = video;
  if (videoWidth === 0 || videoHeight === 0) return null;

  const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(videoWidth, videoHeight));
  canvas.width = Math.round(videoWidth * scale);
  canvas.height = Math.round(videoHeight * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Strip the `data:image/jpeg;base64,` prefix — the API wants raw base64.
  return canvas.toDataURL("image/jpeg", FRAME_JPEG_QUALITY).split(",")[1] ?? null;
}

/**
 * Continuously identifies whatever the camera is pointed at by sampling frames
 * and calling the existing `/api/species-id` endpoint, one request at a time.
 */
export function useLiveId({ videoRef, active, latitude, longitude }: UseLiveIdOptions) {
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [isInferring, setIsInferring] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      // HAVE_CURRENT_DATA — there's a decoded frame to sample.
      if (video && video.readyState >= 2) {
        const base64 = captureFrame(video, canvas);
        if (base64) {
          setIsInferring(true);
          try {
            const params: Parameters<typeof identifySpecies>[0] = {
              image: base64,
              limit: LIVE_LIMIT,
            };
            if (latitude != null && Number.isFinite(latitude)) params.latitude = latitude;
            if (longitude != null && Number.isFinite(longitude)) params.longitude = longitude;

            const result = await identifySpecies(params);
            if (!cancelled) setSuggestions(result.suggestions);
          } catch {
            // Transient failures (offline, server hiccup) are expected in a
            // continuous loop — keep the last result and try again next tick.
          } finally {
            if (!cancelled) setIsInferring(false);
          }
        }
      }
      if (!cancelled) timer = setTimeout(() => void tick(), MIN_GAP_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, latitude, longitude, videoRef]);

  return { suggestions, isInferring };
}
