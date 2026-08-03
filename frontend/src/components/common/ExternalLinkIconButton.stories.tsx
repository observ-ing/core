import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { ExternalLinkIconButton } from "./ExternalLinkIconButton";

const meta = {
  title: "Common/ExternalLinkIconButton",
  component: ExternalLinkIconButton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    href: "https://www.gbif.org/species/1",
    label: "Panthera leo",
  },
} satisfies Meta<typeof ExternalLinkIconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LargerIcon: Story = {
  args: { fontSize: 16 },
};

export const Row: Story = {
  render: () => (
    <Stack direction="row" spacing={1}>
      <ExternalLinkIconButton href="https://www.gbif.org/species/1" label="Panthera leo" />
      <ExternalLinkIconButton
        href="https://www.gbif.org/species/2"
        label="Ursus arctos"
        fontSize={16}
      />
    </Stack>
  ),
};
