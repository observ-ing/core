import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { ExternalLinkChip } from "./ExternalLinkChip";

const meta = {
  title: "Common/ExternalLinkChip",
  component: ExternalLinkChip,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    label: "GBIF",
    href: "https://www.gbif.org/",
  },
} satisfies Meta<typeof ExternalLinkChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Pair: Story = {
  render: () => (
    <Stack direction="row" spacing={1.25}>
      <ExternalLinkChip label="GBIF" href="https://www.gbif.org/" />
      <ExternalLinkChip label="Wikidata" href="https://www.wikidata.org/" />
    </Stack>
  ),
};
