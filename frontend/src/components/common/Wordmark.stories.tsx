import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { Wordmark } from "./Wordmark";
import { Logo } from "./Logo";

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

export const Lockup: Story = {
  render: () => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <Box sx={{ color: "primary.main", display: "inline-flex" }}>
        <Logo size={32} />
      </Box>
      <Wordmark />
    </Box>
  ),
  parameters: {
    docs: {
      description: {
        story: "The full brand lockup as used in the top bar: leaf-eye mark + wordmark.",
      },
    },
  },
};
