import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { Logo } from "./Logo";

const meta = {
  title: "Common/Logo",
  component: Logo,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    // The mark is drawn with `currentColor`, so it inherits the accent green
    // from its parent — mirror how the app renders it (color: primary.main).
    // Switch the Storybook theme (light/dark) to see it adapt.
    (Story) => (
      <Box sx={{ color: "primary.main", display: "inline-flex" }}>
        <Story />
      </Box>
    ),
  ],
  argTypes: {
    size: { control: { type: "number" } },
  },
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { size: 64 },
};

export const Favicon: Story = {
  args: { size: 16 },
  parameters: {
    docs: {
      description: {
        story: "The mark holds up at favicon scale — flat fill, no fine detail to lose.",
      },
    },
  },
};

export const Hero: Story = {
  args: { size: 128 },
};
