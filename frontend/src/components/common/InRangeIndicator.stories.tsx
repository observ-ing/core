import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Typography } from "@mui/material";
import { InRangeIndicator } from "./InRangeIndicator";

const meta = {
  title: "Common/InRangeIndicator",
  component: InRangeIndicator,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof InRangeIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LargerIcon: Story = {
  args: { size: 16 },
};

export const InlineWithText: Story = {
  render: () => (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
      <Typography sx={{ fontStyle: "italic", fontWeight: 600 }}>Panthera leo</Typography>
      <InRangeIndicator />
    </Stack>
  ),
};

export const OnDarkBackground: Story = {
  args: { size: 16, color: "success.light" },
  parameters: {
    backgrounds: { default: "dark" },
  },
  render: (args) => (
    <Stack sx={{ bgcolor: "grey.900", p: 2, borderRadius: 1 }}>
      <InRangeIndicator {...args} />
    </Stack>
  ),
};
