import type { Meta, StoryObj } from "@storybook/react-vite";
import { ObservationDetailSkeleton } from "./ObservationDetailSkeleton";

const meta = {
  title: "Observation/ObservationDetailSkeleton",
  component: ObservationDetailSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ObservationDetailSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
