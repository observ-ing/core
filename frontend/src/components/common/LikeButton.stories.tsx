import type { Meta, StoryObj } from "@storybook/react-vite";
import { LikeButton } from "./LikeButton";

const meta = {
  title: "Common/LikeButton",
  component: LikeButton,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    liked: false,
    count: 0,
    onToggle: () => {},
  },
} satisfies Meta<typeof LikeButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unliked: Story = {};

export const Liked: Story = {
  args: { liked: true, count: 1 },
};

export const WithCount: Story = {
  args: { liked: true, count: 42 },
};

export const LoggedOut: Story = {
  args: { loggedOut: true, count: 5 },
};

export const Pending: Story = {
  args: { disabled: true, count: 3 },
};
