import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import type { TaxaResult } from "../../services/types";
import { MatchedSynonym } from "./MatchedSynonym";

const SPECIES_SYNONYM: TaxaResult = {
  id: "Plantae/Rhaphiolepis bibas",
  scientificName: "Rhaphiolepis bibas",
  commonName: "Loquat",
  rank: "species",
  kingdom: "Plantae",
  family: "Rosaceae",
  genus: "Rhaphiolepis",
  source: "gbif",
  matchedSynonym: "Eriobotrya japonica",
};

const GENUS_SYNONYM: TaxaResult = {
  id: "Plantae/Eriobotrya",
  scientificName: "Rhaphiolepis",
  rank: "genus",
  kingdom: "Plantae",
  family: "Rosaceae",
  source: "gbif",
  matchedSynonym: "Eriobotrya",
};

const FAMILY_SYNONYM: TaxaResult = {
  id: "Plantae/Rosaceae",
  scientificName: "Rosaceae",
  rank: "family",
  kingdom: "Plantae",
  source: "gbif",
  matchedSynonym: "Maloideae",
};

const MATCHED_BY_OWN_NAME: TaxaResult = {
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
  title: "Common/MatchedSynonym",
  component: MatchedSynonym,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    taxon: SPECIES_SYNONYM,
  },
} satisfies Meta<typeof MatchedSynonym>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Species: Story = {};

export const Genus: Story = {
  args: {
    taxon: GENUS_SYNONYM,
  },
};

export const FamilyNotItalicized: Story = {
  args: {
    taxon: FAMILY_SYNONYM,
  },
};

export const NoSynonymRendersNothing: Story = {
  args: {
    taxon: MATCHED_BY_OWN_NAME,
  },
  parameters: {
    docs: {
      description: {
        story:
          "When the result matched by its own names there is no synonym, so the component renders nothing.",
      },
    },
  },
};

export const TypographyProps: Story = {
  args: {
    taxon: SPECIES_SYNONYM,
  },
  render: (args) => (
    <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
      <MatchedSynonym {...args} variant="body2" color="text.secondary" />
      <MatchedSynonym {...args} variant="caption" color="primary" />
    </Stack>
  ),
};
