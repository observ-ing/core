import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { BatchEditor } from "./BatchEditor";
import { storyObservation, storyPhoto } from "./storyFixtures";

const meta = {
  title: "Batch/BatchEditor",
  component: BatchEditor,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: { selected: [], onEdit: () => {} },
  decorators: [
    (Story) => (
      <Box sx={{ width: 400 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof BatchEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingSelected: Story = {};

/** Unidentified, so the cover photo is offered for visual ID. */
export const SingleUnidentified: Story = {
  args: { selected: [storyObservation()] },
};

export const SingleWithDateRange: Story = {
  args: {
    selected: [
      storyObservation({
        taxon: { name: "Quercus robur", match: null, kingdom: "Plantae", rank: "species" },
        endDate: "2026-10-05",
        remarks: "Acorns on the ground under the canopy",
      }),
    ],
  },
};

/** A name that isn't in the taxonomy needs a kingdom before it can be uploaded. */
export const UnmatchedName: Story = {
  args: {
    selected: [
      storyObservation({ taxon: { name: "Hippodamia sp. A", match: null, kingdom: "", rank: "" } }),
    ],
  },
};

export const MissingDateAndLocation: Story = {
  args: { selected: [storyObservation({ date: "", latitude: null, longitude: null })] },
};

/** Fields the selection disagrees on are blank; the map shows every pin in grey. */
export const MultipleMixed: Story = {
  args: {
    selected: [
      storyObservation({
        taxon: { name: "Quercus robur", match: null, kingdom: "Plantae", rank: "" },
      }),
      storyObservation({
        id: "o2",
        photos: [storyPhoto(1)],
        date: "2026-10-04T08:15",
        latitude: 37.91,
        longitude: -122.25,
        remarks: "Creek trail",
      }),
      storyObservation({ id: "o3", photos: [storyPhoto(2)], latitude: 37.9, longitude: -122.23 }),
    ],
  },
};
