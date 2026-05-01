import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeedEndIndicator } from "./FeedEndIndicator";

const meta = {
  title: "Feed/FeedEndIndicator",
  component: FeedEndIndicator,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof FeedEndIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithoutCount: Story = {};

export const WithCount: Story = {
  args: { count: 47 },
};
