import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadMoreButton } from "./LoadMoreButton";

const meta = {
  title: "Common/LoadMoreButton",
  component: LoadMoreButton,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    onClick: () => {},
  },
} satisfies Meta<typeof LoadMoreButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    loading: false,
  },
};

export const Loading: Story = {
  args: {
    loading: true,
  },
};
