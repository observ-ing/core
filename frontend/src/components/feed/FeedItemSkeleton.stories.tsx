import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeedItemSkeleton } from "./FeedItemSkeleton";

const meta = {
  title: "Feed/FeedItemSkeleton",
  component: FeedItemSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof FeedItemSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
