import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProfileObservationCardSkeleton } from "./ProfileObservationCardSkeleton";

const meta = {
  title: "Profile/ProfileObservationCardSkeleton",
  component: ProfileObservationCardSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ProfileObservationCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
