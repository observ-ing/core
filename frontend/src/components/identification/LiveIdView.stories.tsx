import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { LiveIdView } from "./LiveIdView";
import type { SpeciesSuggestion } from "../../services/api";

const SUGGESTIONS: SpeciesSuggestion[] = [
  {
    scientificName: "Quercus robur",
    confidence: 0.92,
    commonName: "English Oak",
    kingdom: "Plantae",
    family: "Fagaceae",
    genus: "Quercus",
    inRange: true,
  },
  {
    scientificName: "Quercus alba",
    confidence: 0.61,
    commonName: "White Oak",
    kingdom: "Plantae",
    family: "Fagaceae",
    genus: "Quercus",
    inRange: false,
  },
  {
    scientificName: "Acer rubrum",
    confidence: 0.38,
    commonName: "Red Maple",
    kingdom: "Plantae",
    family: "Sapindaceae",
    genus: "Acer",
  },
];

const speciesIdHandler = http.post("/api/species-id", () =>
  HttpResponse.json({ suggestions: SUGGESTIONS, modelVersion: "story", inferenceTimeMs: 120 }),
);

// --- browser API mocks ------------------------------------------------------
// LiveIdView gates on geolocation before starting the camera, then samples the
// live <video> stream. These stubs let each state be viewed without real
// hardware; they're installed in beforeEach (so they're in place before the
// component's mount effect runs) and restored by the returned cleanup.

type GeoBehavior = "granted" | "denied" | "pending";

function mockGeolocation(behavior: GeoBehavior): () => void {
  const original = navigator.geolocation;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      // Typed with the minimal shapes LiveIdView actually consumes (it only
      // reads coords.latitude/longitude and ignores the error payload), so the
      // literal needs no full GeolocationPosition / ...PositionError cast.
      getCurrentPosition(
        success: (position: { coords: { latitude: number; longitude: number } }) => void,
        error?: (err: { code: number; message: string }) => void,
      ): void {
        if (behavior === "granted") {
          success({ coords: { latitude: 40.015, longitude: -105.2705 } });
        } else if (behavior === "denied") {
          error?.({ code: 1, message: "User denied Geolocation" });
        }
        // "pending": never invoke a callback, leaving the prompt on screen.
      },
    },
  });
  return () =>
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: original });
}

// Feed the camera a self-drawn, animating canvas so the <video> actually plays
// (firing `onPlaying`) and the identification loop has frames to sample.
function mockCamera(): () => void {
  const original = navigator.mediaDevices;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  let raf = 0;
  let t = 0;
  const draw = () => {
    if (ctx) {
      ctx.fillStyle = "#2e5d34";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#7cb342";
      ctx.beginPath();
      ctx.arc(640 + Math.sin(t / 30) * 120, 360, 140, 0, Math.PI * 2);
      ctx.fill();
    }
    t += 1;
    raf = requestAnimationFrame(draw);
  };
  draw();
  const stream = canvas.captureStream(15);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => stream },
  });
  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((track) => track.stop());
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: original });
  };
}

/**
 * Full-screen live camera identifier. Stories stub `navigator.geolocation` and
 * `getUserMedia`, since the real component needs a granted location and a rear
 * camera before it shows anything.
 */
const meta = {
  title: "Identification/LiveIdView",
  component: LiveIdView,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  // Default to the location-prompt state so the autodocs preview is stable.
  beforeEach: () => mockGeolocation("pending"),
} satisfies Meta<typeof LiveIdView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Location permission is still pending — the camera hasn't started yet. */
export const RequestingLocation: Story = {
  beforeEach: () => mockGeolocation("pending"),
};

/** Location was denied — show the blocking gate with a retry. */
export const LocationDenied: Story = {
  beforeEach: () => mockGeolocation("denied"),
};

/**
 * Location granted and the camera running: the live overlay shows the top guess
 * (with an in-range 📍), its percentage, common name, and runner-ups, updating
 * as the mocked `/api/species-id` endpoint responds.
 */
export const Live: Story = {
  parameters: {
    msw: { handlers: [speciesIdHandler] },
  },
  beforeEach: () => {
    const restoreGeo = mockGeolocation("granted");
    const restoreCamera = mockCamera();
    return () => {
      restoreCamera();
      restoreGeo();
    };
  },
};
