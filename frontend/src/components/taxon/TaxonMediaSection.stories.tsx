import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonMediaSection } from "./TaxonMediaSection";
import { OAK_TAXON_DETAIL } from "../../../.storybook/fixtures";

const meta = {
  title: "Taxon/TaxonMediaSection",
  component: TaxonMediaSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonMediaSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    scientificName: OAK_TAXON_DETAIL.scientificName,
  },
};
