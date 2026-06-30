import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { Box } from "@mui/material";
import { TaxonSearchBox } from "./TaxonSearchBox";
import type { TaxaResult } from "../../services/types";

const SAMPLE_RESULTS: TaxaResult[] = [
  {
    id: "Plantae/Quercus-robur",
    scientificName: "Quercus robur",
    commonName: "English oak",
    rank: "species",
    kingdom: "Plantae",
    source: "gbif",
  },
  {
    id: "Plantae/Quercus-alba",
    scientificName: "Quercus alba",
    commonName: "White oak",
    rank: "species",
    kingdom: "Plantae",
    source: "gbif",
  },
  {
    id: "Plantae/Quercus",
    scientificName: "Quercus",
    commonName: "Oaks",
    rank: "genus",
    kingdom: "Plantae",
    source: "gbif",
  },
];

const meta = {
  title: "Taxon/TaxonSearchBox",
  component: TaxonSearchBox,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 300 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof TaxonSearchBox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithResults: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/taxa/search", () => HttpResponse.json({ results: SAMPLE_RESULTS })),
      ],
    },
  },
};
