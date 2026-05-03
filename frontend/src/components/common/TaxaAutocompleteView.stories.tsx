import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { TaxaAutocompleteView } from "./TaxaAutocompleteView";
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
  title: "Common/TaxaAutocompleteView",
  component: TaxaAutocompleteView,
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
    return <TaxaAutocompleteView {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof TaxaAutocompleteView>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

export const WithResults: Story = {
  args: {
    value: "Quercus",
    options: SAMPLE_RESULTS,
    loading: false,
    open: true,
    onChange: noop,
    onSearch: noop,
    onClear: noop,
  },
};

export const Loading: Story = {
  args: {
    value: "Quercus",
    options: [],
    loading: true,
    open: true,
    onChange: noop,
    onSearch: noop,
    onClear: noop,
  },
};

export const NoResults: Story = {
  args: {
    value: "asdjkfhasdf",
    options: [],
    loading: false,
    open: true,
    onChange: noop,
    onSearch: noop,
    onClear: noop,
  },
};

export const Empty: Story = {
  args: {
    value: "",
    options: [],
    loading: false,
    onChange: noop,
    onSearch: noop,
    onClear: noop,
  },
};
