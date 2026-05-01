import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { ImageWithSkeleton } from "./ImageWithSkeleton";

const meta = {
  title: "Common/ImageWithSkeleton",
  component: ImageWithSkeleton,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 320, height: 240 }}>
        <Story />
      </Box>
    ),
  ],
  argTypes: {
    src: { control: { type: "text" } },
    alt: { control: { type: "text" } },
  },
} satisfies Meta<typeof ImageWithSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  args: {
    src: "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=320",
    alt: "Quercus robur leaves",
  },
};

export const BrokenSrcKeepsSkeleton: Story = {
  args: {
    src: "https://example.invalid/this-will-fail.jpg",
    alt: "Will not load",
  },
  parameters: {
    docs: {
      description: {
        story:
          "When the image URL fails, the skeleton stays — there's no error UI. This documents the current behavior; a follow-up could add a fallback.",
      },
    },
  },
};
