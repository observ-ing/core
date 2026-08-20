import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@mui/material";
import { ButtonSpinner } from "./ButtonSpinner";

const meta = {
  title: "Common/ButtonSpinner",
  component: ButtonSpinner,
  tags: ["autodocs"],
} satisfies Meta<typeof ButtonSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Larger: Story = {
  args: { size: 24 },
};

export const InButton: Story = {
  args: {},
  render: (args) => (
    <Button variant="contained" disabled startIcon={<ButtonSpinner {...args} />}>
      Saving...
    </Button>
  ),
};
