import type { Meta, StoryObj } from "@storybook/react-vite";
import { CenteredSpinner } from "./CenteredSpinner";

const meta = {
  title: "Common/CenteredSpinner",
  component: CenteredSpinner,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    size: { control: { type: "number" } },
    p: { control: { type: "number" } },
  },
} satisfies Meta<typeof CenteredSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = {
  args: {
    color: "primary",
  },
};

export const Large: Story = {
  args: {
    size: 40,
  },
};

export const TighterPadding: Story = {
  args: {
    p: 3,
  },
};

/** Suspense-fallback use: a fixed-height slot with the spinner in its middle. */
export const FillsSlot: Story = {
  args: {
    sx: { height: 260, border: 1, borderColor: "divider" },
  },
};
