import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkippedFilesDialog } from "./SkippedFilesDialog";

const meta = {
  title: "Batch/SkippedFilesDialog",
  component: SkippedFilesDialog,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: { open: true, addedCount: 12, onClose: () => {} },
} satisfies Meta<typeof SkippedFilesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    skipped: [
      { name: "IMG_5001.heic", reason: "Not a JPEG, PNG, or WebP" },
      { name: "trip-notes.pdf", reason: "Not a JPEG, PNG, or WebP" },
      { name: "pano_ridge.jpg", reason: "Larger than 10 MB" },
      { name: "IMG_5107.jpg", reason: "Over the 100-photo limit" },
    ],
  },
};

export const NothingAdded: Story = {
  args: {
    addedCount: 0,
    skipped: [{ name: "trip-notes.pdf", reason: "Not a JPEG, PNG, or WebP" }],
  },
};
