import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandLockup } from "./BrandLockup";

const meta = {
  title: "Common/BrandLockup",
  component: BrandLockup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof BrandLockup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The home link used in TopBar and Sidebar: leaf-eye mark (tinted primary) + wordmark.",
      },
    },
  },
};

export const CompactLogo: Story = {
  args: {
    logoSize: 28,
  },
  parameters: {
    docs: {
      description: {
        story: "Sidebar sizing — a smaller logo mark than the top bar's.",
      },
    },
  },
};
