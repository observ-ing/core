import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChipSkeleton } from "./ChipSkeleton";

const meta = {
  title: "Common/ChipSkeleton",
  component: ChipSkeleton,
  tags: ["autodocs"],
  args: { width: 80 },
} satisfies Meta<typeof ChipSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tall: Story = { args: { width: 130, height: 32 } };
