import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneGrid } from "./PhoneGrid";
import { STORY_BATCH, phoneFrame } from "./phoneStoryFixtures";
import { storyObservation, storyPhoto } from "../storyFixtures";

const noop = () => {};

const meta = {
  title: "Batch/Phone/PhoneGrid",
  component: PhoneGrid,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: {
    observations: STORY_BATCH,
    selected: [],
    onlyIncomplete: false,
    onFilter: noop,
    converting: 0,
    blocked: false,
    onOpen: noop,
    onToggle: noop,
    onSelectAll: noop,
    onClearSelection: noop,
    onAddPhotos: noop,
    onUpload: noop,
    onEditSelected: noop,
    onCombine: noop,
    onSplit: noop,
    onRemoveSelected: noop,
  },
} satisfies Meta<typeof PhoneGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Review: Story = {};

export const IncompleteOnly: Story = { args: { onlyIncomplete: true } };

/** With anything checked, the bars at the top and bottom act on the selection. */
export const Selecting: Story = { args: { selected: ["o1", "o2", "o4"] } };

export const ReadyToUpload: Story = {
  args: { observations: STORY_BATCH.slice(0, 3) },
};

export const ReadingPhotos: Story = {
  args: {
    observations: [
      storyObservation({
        photos: [storyPhoto(0, false)],
        date: "",
        latitude: null,
        longitude: null,
      }),
      ...STORY_BATCH.slice(1, 3),
    ],
  },
};
