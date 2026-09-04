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
    emptyText: { control: { type: "text" } },
    objectFit: { control: { type: "radio" }, options: ["cover", "contain"] },
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

export const ContainFit: Story = {
  args: {
    src: "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=320",
    alt: "Quercus robur leaves",
    objectFit: "contain",
  },
  parameters: {
    docs: {
      description: {
        story:
          '`objectFit="contain"` letterboxes the image instead of cropping it — used by `TaxonHeroCard` so the full specimen photo stays visible.',
      },
    },
  },
};

export const EmptyFallback: Story = {
  args: {
    src: undefined,
    alt: "No observation image",
  },
  parameters: {
    docs: {
      description: {
        story:
          "When no `src` is provided, the component renders the built-in 'No image' placeholder instead of an image.",
      },
    },
  },
};

export const EmptyFallbackCustomText: Story = {
  args: {
    src: undefined,
    alt: "No observation image",
    emptyText: "No photo yet",
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
