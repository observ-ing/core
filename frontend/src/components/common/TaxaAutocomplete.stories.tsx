import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { Box } from "@mui/material";
import { TaxaAutocomplete } from "./TaxaAutocomplete";
import type { TaxaResult } from "../../services/types";

const SAMPLE_RESULTS: TaxaResult[] = [
  {
    id: "Plantae/Quercus robur",
    scientificName: "Quercus robur",
    commonName: "English Oak",
    rank: "species",
    kingdom: "Plantae",
    family: "Fagaceae",
    genus: "Quercus",
    source: "gbif",
    conservationStatus: { category: "LC", source: "IUCN" },
  },
  {
    id: "Plantae/Quercus alba",
    scientificName: "Quercus alba",
    commonName: "White Oak",
    rank: "species",
    kingdom: "Plantae",
    family: "Fagaceae",
    genus: "Quercus",
    source: "gbif",
    conservationStatus: { category: "LC", source: "IUCN" },
  },
  {
    id: "Plantae/Quercus rubra",
    scientificName: "Quercus rubra",
    commonName: "Northern Red Oak",
    rank: "species",
    kingdom: "Plantae",
    family: "Fagaceae",
    genus: "Quercus",
    source: "gbif",
  },
];

const meta = {
  title: "Common/TaxaAutocomplete",
  component: TaxaAutocomplete,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 380 }}>
        <Story />
      </Box>
    ),
  ],
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <TaxaAutocomplete {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof TaxaAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithResults: Story = {
  args: {
    value: "Quercus",
    onChange: () => undefined,
  },
  parameters: {
    msw: {
      handlers: [http.get("/api/taxa/search", () => HttpResponse.json(SAMPLE_RESULTS))],
    },
  },
};

export const NoResults: Story = {
  args: {
    value: "asdjkfhasdf",
    onChange: () => undefined,
  },
  parameters: {
    msw: {
      handlers: [http.get("/api/taxa/search", () => HttpResponse.json([]))],
    },
  },
};

export const Empty: Story = {
  args: {
    value: "",
    onChange: () => undefined,
  },
};
