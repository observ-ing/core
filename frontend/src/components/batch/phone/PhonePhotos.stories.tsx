import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhonePhotos } from "./PhonePhotos";
import { phoneFrame } from "./phoneStoryFixtures";
import { storyObservation, storyPhoto } from "../storyFixtures";

const noop = () => {};

const meta = {
  title: "Batch/Phone/PhonePhotos",
  component: PhonePhotos,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: {
    observation: storyObservation({
      photos: [storyPhoto(0), storyPhoto(1), storyPhoto(2), storyPhoto(3)],
    }),
    notice: null,
    onBack: noop,
    onAdd: noop,
    onReorder: noop,
    onSplit: noop,
    onRemove: noop,
    onUndo: noop,
    onDismissNotice: noop,
  },
} satisfies Meta<typeof PhonePhotos>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tap a photo to select it; touch and hold, then drag, to reorder. */
export const Several: Story = {};

/**
 * A browser that can't start a drag by touch (Firefox on Android): select a
 * photo, then move it with the buttons in the bottom bar.
 */
export const WithoutTouchDrag: Story = {
  args: { touchDrag: false },
};

/** One photo can be removed, taking the observation with it, but not split off. */
export const LonePhoto: Story = {
  args: { observation: storyObservation() },
};

export const AfterSplit: Story = {
  args: {
    observation: storyObservation({ photos: [storyPhoto(0), storyPhoto(1), storyPhoto(3)] }),
    notice: {
      title: "Split into a new observation",
      detail: "Now observation 6 of 13. It has its own date and location from the photo.",
      thumbnailUrl: storyPhoto(2).previewUrl,
      onEdit: noop,
    },
  },
};

export const AfterRemove: Story = {
  args: {
    observation: storyObservation({ photos: [storyPhoto(0), storyPhoto(1)] }),
    notice: { title: "2 photos removed", thumbnailUrl: storyPhoto(2).previewUrl },
  },
};
