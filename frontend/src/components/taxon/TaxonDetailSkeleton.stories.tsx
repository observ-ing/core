import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonDetailSkeleton } from "./TaxonDetailSkeleton";

const meta = {
  title: "Taxon/TaxonDetailSkeleton",
  component: TaxonDetailSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonDetailSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
