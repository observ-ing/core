import type { Meta, StoryObj } from "@storybook/react-vite";
import { SectionCardSkeleton } from "./SectionCardSkeleton";

const meta = {
  title: "Common/SectionCardSkeleton",
  component: SectionCardSkeleton,
  tags: ["autodocs"],
  args: { height: 66 },
} satisfies Meta<typeof SectionCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tall: Story = { args: { height: 180 } };
