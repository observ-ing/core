import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButtonSkeleton } from "./IconButtonSkeleton";

const meta = {
  title: "Common/IconButtonSkeleton",
  component: IconButtonSkeleton,
  tags: ["autodocs"],
} satisfies Meta<typeof IconButtonSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
