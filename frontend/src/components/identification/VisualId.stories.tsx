import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Box } from "@mui/material";
import { VisualId } from "./VisualId";
import type { SpeciesSuggestion } from "../../services/api";
import { resetSpeciesIdWarmupForTests } from "../../lib/speciesIdWarmup";

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
    scientificName: "Quercus petraea",
    confidence: 0.34,
    commonName: "Sessile Oak",
    kingdom: "Plantae",
    family: "Fagaceae",
    genus: "Quercus",
  },
];

// 1x1 transparent PNG — the hook fetches this URL to base64 before POSTing
// to /api/species-id, so a real-but-tiny payload is needed for the story
// to actually trigger the mocked endpoint.
const SAMPLE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const meta = {
  title: "Identification/VisualId",
  component: VisualId,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  // Warm-up state is module-level; start every story from "unknown".
  beforeEach: () => resetSpeciesIdWarmupForTests(),
  args: {
    imageUrl: SAMPLE_IMAGE,
    onSelect: () => undefined,
    onSelectAncestor: () => undefined,
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 400 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof VisualId>;

export default meta;
type Story = StoryObj<typeof meta>;

const successHandler = http.post("/api/species-id", () =>
  HttpResponse.json({ suggestions: SUGGESTIONS }),
);

export const ManualFetch: Story = {
  parameters: {
    msw: { handlers: [successHandler] },
  },
};

export const AutoFetched: Story = {
  args: { autoFetch: true },
  parameters: {
    msw: { handlers: [successHandler] },
  },
};

export const AutoFetchLoading: Story = {
  args: { autoFetch: true },
  parameters: {
    msw: {
      handlers: [
        http.post("/api/species-id", async () => {
          await delay("infinite");
          return HttpResponse.json({ suggestions: [] });
        }),
      ],
    },
  },
};

/** Species-id is booting from zero: the pending state counts down. */
export const AutoFetchColdStart: Story = {
  args: { autoFetch: true },
  parameters: {
    msw: {
      handlers: [
        http.get("/api/species-id/status", () =>
          HttpResponse.json({ ready: false, estimatedSeconds: 20 }),
        ),
        http.post("/api/species-id", async () => {
          await delay("infinite");
          return HttpResponse.json({ suggestions: [] });
        }),
      ],
    },
  },
};

export const NoSuggestions: Story = {
  args: { autoFetch: true, quiet: true },
  parameters: {
    msw: {
      handlers: [http.post("/api/species-id", () => HttpResponse.json({ suggestions: [] }))],
    },
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
