import type { Meta, StoryObj } from "@storybook/react-vite";
import { Typography } from "@mui/material";
import { TaxonAccordion } from "./TaxonAccordion";

const meta = {
  title: "Taxon/TaxonAccordion",
  component: TaxonAccordion,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonAccordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  args: {
    title: "Section",
    children: <Typography variant="body2">Body content goes here.</Typography>,
  },
};

export const Expanded: Story = {
  args: {
    title: "Section",
    defaultExpanded: true,
    children: <Typography variant="body2">Body content goes here.</Typography>,
  },
};
