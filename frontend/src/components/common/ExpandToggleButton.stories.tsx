import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExpandToggleButton } from "./ExpandToggleButton";

const meta = {
  title: "Common/ExpandToggleButton",
  component: ExpandToggleButton,
  tags: ["autodocs"],
} satisfies Meta<typeof ExpandToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  args: { expanded: false },
};

export const Expanded: Story = {
  args: { expanded: true },
};
