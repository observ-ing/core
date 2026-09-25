import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { CloseIconButton } from "./CloseIconButton";

const meta = {
  title: "Common/CloseIconButton",
  component: CloseIconButton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    onClick: () => {},
  },
} satisfies Meta<typeof CloseIconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: { "aria-label": "Dismiss" },
};

export const OnDarkOverlay: Story = {
  render: (args) => (
    <Box sx={{ bgcolor: "common.black", p: 2, display: "inline-flex" }}>
      <CloseIconButton {...args} sx={{ color: "common.white" }} />
    </Box>
  ),
};
