import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { BatchCard } from "./BatchCard";
import { storyObservation, storyPhoto } from "./storyFixtures";

const noop = () => {};

const meta = {
  title: "Batch/BatchCard",
  component: BatchCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    observation: storyObservation(),
    selected: false,
    locked: false,
    dropState: "none",
    combinedPhotoCount: 2,
    insertionIndex: null,
    draggingPhotoId: null,
    onSelect: noop,
    onCardDragStart: noop,
    onPhotoDragStart: noop,
    onDragEnd: noop,
    onDragOver: noop,
    onDragLeave: noop,
    onDrop: noop,
    onRetry: noop,
    onRemove: noop,
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 240 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof BatchCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const identified = { name: "Quercus robur", match: null, kingdom: "Plantae", rank: "species" };
const fourPhotos = [0, 1, 2, 3].map((i) => storyPhoto(i));

export const Default: Story = {};

export const Selected: Story = {
  args: { selected: true, observation: storyObservation({ taxon: identified }) },
};

export const MultiplePhotos: Story = {
  args: {
    observation: storyObservation({
      photos: fourPhotos,
      taxon: identified,
      remarks: "Acorns on the ground under the canopy",
    }),
  },
};

/** Ranks above genus are not italicized. */
export const FamilyRank: Story = {
  args: {
    observation: storyObservation({
      taxon: { name: "Coccinellidae", match: null, kingdom: "Animalia", rank: "family" },
    }),
  },
};

export const ReadingExif: Story = {
  args: {
    observation: storyObservation({
      photos: [storyPhoto(0, false)],
      date: "",
      latitude: null,
      longitude: null,
    }),
  },
};

export const MissingDate: Story = {
  args: { observation: storyObservation({ date: "" }) },
};

export const MissingLocation: Story = {
  args: { observation: storyObservation({ latitude: null, longitude: null }) },
};

export const MissingKingdom: Story = {
  args: {
    observation: storyObservation({
      taxon: { name: "Hippodamia sp. A", match: null, kingdom: "", rank: "" },
    }),
  },
};

export const DateRange: Story = {
  args: { observation: storyObservation({ endDate: "2026-10-05" }) },
};

/** Another card is being dragged over this one. */
export const CombineTarget: Story = {
  args: { dropState: "combine" },
};

/** Files from the computer are being dragged over this card. */
export const AddFilesTarget: Story = {
  args: { dropState: "add", combinedPhotoCount: 3 },
};

/** The drop would put more than 10 photos in one observation. */
export const CombineRefused: Story = {
  args: { dropState: "refuse", observation: storyObservation({ photos: fourPhotos }) },
};

/** A photo is being dragged to a new position within its own card. */
export const Reordering: Story = {
  args: {
    observation: storyObservation({ photos: fourPhotos }),
    insertionIndex: 2,
    draggingPhotoId: "p3",
  },
};

export const Queued: Story = {
  args: { locked: true, observation: storyObservation({ status: "queued" }) },
};

export const Uploading: Story = {
  args: { locked: true, observation: storyObservation({ status: "uploading" }) },
};

export const Failed: Story = {
  args: {
    observation: storyObservation({ status: "failed", error: "Failed to submit" }),
  },
};
