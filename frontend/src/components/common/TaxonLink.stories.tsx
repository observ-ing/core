import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { TaxonLink } from "./TaxonLink";

const meta = {
  title: "Common/TaxonLink",
  component: TaxonLink,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: { type: "radio" },
      options: ["text", "chip"],
    },
    italic: {
      control: { type: "boolean" },
    },
  },
} satisfies Meta<typeof TaxonLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SpeciesText: Story = {
  args: {
    name: "Quercus alba",
    kingdom: "Plantae",
    rank: "species",
  },
};

export const SpeciesChip: Story = {
  args: {
    name: "Quercus alba",
    kingdom: "Plantae",
    rank: "species",
    variant: "chip",
  },
};

export const FamilyNotItalicized: Story = {
  args: {
    name: "Fagaceae",
    kingdom: "Plantae",
    rank: "family",
  },
};

export const KingdomDirect: Story = {
  args: {
    name: "Plantae",
    rank: "kingdom",
  },
};

export const NoKingdomFallsBackToText: Story = {
  args: {
    name: "Quercus alba",
    rank: "species",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Without a `kingdom` prop the component can't build a URL, so it renders as plain styled text instead of a link.",
      },
    },
  },
};

export const Variants: Story = {
  args: {
    name: "Quercus alba",
    kingdom: "Plantae",
    rank: "species",
  },
  render: (args) => (
    <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
      <TaxonLink {...args} variant="text" />
      <TaxonLink {...args} variant="chip" />
      <TaxonLink {...args} italic={false} />
    </Stack>
  ),
};
