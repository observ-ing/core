import type { Meta, StoryObj } from "@storybook/react-vite";
import { DetailHeaderTitle } from "./DetailHeaderTitle";

const meta = {
  title: "Common/DetailHeaderTitle",
  component: DetailHeaderTitle,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DetailHeaderTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Observation",
  },
};

export const LongTitle: Story = {
  args: {
    children: "Subspecies",
  },
};
