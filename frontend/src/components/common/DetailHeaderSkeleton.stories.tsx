import type { Meta, StoryObj } from "@storybook/react-vite";
import { DetailHeaderSkeleton } from "./DetailHeaderSkeleton";

const meta = {
  title: "Common/DetailHeaderSkeleton",
  component: DetailHeaderSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    titleWidth: { control: { type: "number" } },
    sticky: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof DetailHeaderSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    titleWidth: 100,
  },
};

export const ShortTitle: Story = {
  args: {
    titleWidth: 60,
  },
};

export const Sticky: Story = {
  args: {
    titleWidth: 60,
    sticky: true,
  },
};
