import type { Meta, StoryObj } from "@storybook/react-vite";
import { ObservationGridCardSkeleton } from "./ObservationGridCardSkeleton";

const meta = {
  title: "Common/ObservationGridCardSkeleton",
  component: ObservationGridCardSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ObservationGridCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
