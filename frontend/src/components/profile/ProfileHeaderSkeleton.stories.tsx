import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProfileHeaderSkeleton } from "./ProfileHeaderSkeleton";

const meta = {
  title: "Profile/ProfileHeaderSkeleton",
  component: ProfileHeaderSkeleton,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ProfileHeaderSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
