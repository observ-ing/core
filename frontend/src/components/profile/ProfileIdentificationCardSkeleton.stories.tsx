import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProfileIdentificationCardSkeleton } from "./ProfileIdentificationCardSkeleton";

const meta = {
  title: "Profile/ProfileIdentificationCardSkeleton",
  component: ProfileIdentificationCardSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ProfileIdentificationCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
