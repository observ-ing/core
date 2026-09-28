import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { CountChip } from "./CountChip";

const meta = {
  title: "Common/CountChip",
  component: CountChip,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    count: 3,
  },
} satisfies Meta<typeof CountChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = {
  args: {
    color: "primary",
  },
};

export const Pair: Story = {
  render: () => (
    <Stack direction="row" spacing={1.25}>
      <CountChip count={12} />
      <CountChip count={4} color="primary" />
    </Stack>
  ),
};
