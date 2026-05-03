import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { Box } from "@mui/material";
import { TaxaAutocomplete } from "./TaxaAutocomplete";
import type { TaxaResult } from "../../services/types";

/**
 * Container stories: exercise the live `useAutocomplete` wiring against MSW.
 * For prop-driven visual variants (results, loading, empty) see
 * `TaxaAutocompleteView.stories`.
 */

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

export const Default: Story = {
  args: {
    value: "",
    onChange: () => undefined,
  },
  parameters: {
    msw: {
      handlers: [http.get("/api/taxa/search", () => HttpResponse.json(SAMPLE_RESULTS))],
    },
  },
};
