import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonMediaAccordion } from "./TaxonMediaAccordion";
import { OAK_TAXON_DETAIL } from "../../../.storybook/fixtures";

const meta = {
  title: "Taxon/TaxonMediaAccordion",
  component: TaxonMediaAccordion,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonMediaAccordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    scientificName: OAK_TAXON_DETAIL.scientificName,
  },
};
