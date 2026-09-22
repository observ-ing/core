import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { TaxonMatchChip } from "./TaxonMatchChip";
import type { TaxaResult } from "../../services/types";

const MATCHED_WITH_PHOTO: TaxaResult = {
  id: "Plantae/Quercus robur",
  scientificName: "Quercus robur",
  commonName: "English Oak",
  rank: "species",
  kingdom: "Plantae",
  family: "Fagaceae",
  genus: "Quercus",
  source: "gbif",
  photoUrl: "https://placehold.co/40x40",
};

const MATCHED_NO_PHOTO: TaxaResult = {
  id: "Plantae/Quercus robur",
  scientificName: "Quercus robur",
  commonName: "English Oak",
  rank: "species",
  kingdom: "Plantae",
  family: "Fagaceae",
  genus: "Quercus",
  source: "gbif",
};

const meta = {
  title: "Common/TaxonMatchChip",
  component: TaxonMatchChip,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonMatchChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExistingWithPhoto: Story = {
  args: { matchedTaxon: MATCHED_WITH_PHOTO },
};

export const ExistingNoPhoto: Story = {
  args: { matchedTaxon: MATCHED_NO_PHOTO },
};

export const NewTaxon: Story = {
  args: { matchedTaxon: null },
};

export const AllStates: Story = {
  args: { matchedTaxon: null },
  render: () => (
    <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
      <TaxonMatchChip matchedTaxon={MATCHED_WITH_PHOTO} />
      <TaxonMatchChip matchedTaxon={MATCHED_NO_PHOTO} />
      <TaxonMatchChip matchedTaxon={null} />
    </Stack>
  ),
};
