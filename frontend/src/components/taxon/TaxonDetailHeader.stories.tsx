import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonDetailHeader } from "./TaxonDetailHeader";

const meta = {
  title: "Taxon/TaxonDetailHeader",
  component: TaxonDetailHeader,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    rank: "species",
    onBack: () => undefined,
  },
} satisfies Meta<typeof TaxonDetailHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTreeToggle: Story = {
  args: {
    onToggleTree: () => undefined,
  },
};
