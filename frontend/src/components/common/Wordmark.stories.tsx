import type { Meta, StoryObj } from "@storybook/react-vite";
import { Wordmark } from "./Wordmark";

const meta = {
  title: "Common/Wordmark",
  component: Wordmark,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Wordmark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "DM Sans 600, with the dot in accent green — the brand moment that highlights the domain structure (observ + .ing).",
      },
    },
  },
};

// The full brand lockup (leaf-eye mark + wordmark) now lives in
// `BrandLockup`, shared by TopBar and Sidebar — see Common/BrandLockup.
