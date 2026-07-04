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

export const Empty: Story = {
  args: {
    references: [],
  },
};

// The section only renders the first 5 references; the trailing count chip
// still reflects the full list, so it reads higher than the visible rows.
export const ManyReferences: Story = {
  args: {
    references: Array.from({ length: 8 }, (_, i) => ({
      citation: `Author ${i + 1}, A. (20${10 + i}). Reference title ${i + 1}.`,
      link: `https://example.org/ref/${i + 1}`,
    })),
  },
};
