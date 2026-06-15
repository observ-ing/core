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

/**
 * How many candidates to request per frame. A few more than we display gives
 * the temporal aggregation more signal (a species ranked 4th one frame and 1st
 * the next still accumulates).
 */
const LIVE_LIMIT = 5;

/**
 * Temporal smoothing: a single frame's top guess is noisy, so we aggregate the
 * recent ones. We keep at most `AGG_MAX_SAMPLES` inferences from the last
 * `AGG_WINDOW_MS`, and rank species by their *mean* confidence across that
 * window — counting frames where a species didn't appear as 0. That rewards
 * species detected consistently over ones that flicker in for a single frame.
 *
 * At ~2.4s per inference (latency + gap) an 8s window holds ~3–4 frames — enough
 * to average out noise while still re-converging quickly when you pan to a new
 * subject. The sample cap is a backstop in case inference gets much faster.
 */
const AGG_WINDOW_MS = 8000;
const AGG_MAX_SAMPLES = 10;

/** How many aggregated candidates to surface to the overlay. */
const DISPLAY_LIMIT = 4;

interface Sample {
  t: number;
  suggestions: SpeciesSuggestion[];
}

/**
 * Collapse a window of per-frame results into a single ranked list. Each
 * species' score is the sum of its confidences across the window divided by the
 * frame count, so a strong-every-frame detection outranks a strong-once one.
 * Metadata (common name, range, taxonomy) is taken from its latest appearance.
 */
function aggregate(samples: Sample[]): SpeciesSuggestion[] {
  const frameCount = samples.length;
  if (frameCount === 0) return [];

  const acc = new Map<string, { sum: number; latest: SpeciesSuggestion }>();
  // Oldest-to-newest, so `latest` ends up holding the most recent appearance.
  for (const sample of samples) {
    for (const s of sample.suggestions) {
      const cur = acc.get(s.scientificName);
      if (cur) {
        cur.sum += s.confidence;
        cur.latest = s;
      } else {
        acc.set(s.scientificName, { sum: s.confidence, latest: s });
      }
    }
  }

  return [...acc.values()]
    .map(({ sum, latest }) => ({ ...latest, confidence: sum / frameCount }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, DISPLAY_LIMIT);
}

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
  const samplesRef = useRef<Sample[]>([]);

  useEffect(() => {
    if (!active) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    samplesRef.current = [];

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
            if (!cancelled) {
              // Append this frame, then drop anything older than the window or
              // beyond the sample cap, and republish the smoothed ranking.
              const now = Date.now();
              const cutoff = now - AGG_WINDOW_MS;
              const next = [...samplesRef.current, { t: now, suggestions: result.suggestions }]
                .filter((s) => s.t >= cutoff)
                .slice(-AGG_MAX_SAMPLES);
              samplesRef.current = next;
              setSuggestions(aggregate(next));
            }
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
