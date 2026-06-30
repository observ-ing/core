import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonReferencesSection } from "./TaxonReferencesSection";

const meta = {
  title: "Taxon/TaxonReferencesSection",
  component: TaxonReferencesSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonReferencesSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    references: [
      {
        citation: "Sterry, P. & Mackay, A. (2005). Complete Mediterranean Wildlife.",
        link: "https://example.org/ref/1",
      },
      {
        citation: "Villa, R. et al. (2009). Farfalle d'Italia.",
        doi: "10.1234/example.doi",
      },
      {
        citation: "Paolucci, P. (2013). Butterflies of Europe (no link).",
      },
    ],
  },
};
