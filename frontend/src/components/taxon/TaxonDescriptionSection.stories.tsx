import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonDescriptionSection } from "./TaxonDescriptionSection";

const meta = {
  title: "Taxon/TaxonDescriptionSection",
  component: TaxonDescriptionSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonDescriptionSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    descriptions: [
      {
        description:
          "<p>It is distributed in Europe and North Africa. It can be found in mainland Italy, Sardinia and Sicily.</p>",
        type: "general",
        source: "Contribution to the knowledge of the arthropods community of northern Italy",
      },
      {
        description:
          "<p>Migratory species widely distributed in many different environments, from the plains to 2500 m a.s.l.</p>",
        type: "habitat",
        source: "Contribution to the knowledge of the arthropods community of northern Italy",
      },
    ],
  },
};

export const SingleSource: Story = {
  args: {
    descriptions: [
      {
        description: "<p>Quercus robur is a deciduous tree native to most of Europe.</p>",
        type: "general",
        source: "Wikipedia",
      },
    ],
  },
};
