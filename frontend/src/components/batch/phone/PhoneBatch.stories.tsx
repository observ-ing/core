import { useReducer } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { batchReducer, initialBatchState } from "../../../lib/batchUpload";
import { PhoneBatch } from "./PhoneBatch";
import { STORY_BATCH, phoneFrame } from "./phoneStoryFixtures";

const noop = () => {};

const meta = {
  title: "Batch/Phone/PhoneBatch",
  component: PhoneBatch,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: {
    observations: [],
    selected: [],
    uploadedCount: 0,
    uploading: false,
    converting: 0,
    blocked: false,
    stripsLocation: false,
    profilePath: "/profile/did:plc:alice",
    dispatch: noop,
    onChoosePhotos: noop,
    onUpload: noop,
    onCancelUpload: noop,
    onRemove: noop,
    onRemoveSelected: noop,
  },
} satisfies Meta<typeof PhoneBatch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Start: Story = {};

/**
 * The whole flow over real batch state, without the picker or the upload:
 * tap a card to edit it (the editor opens full screen), check cards to combine
 * or split them, and manage one observation's photos.
 */
export const Interactive: Story = {
  render: function Render(args) {
    const [state, dispatch] = useReducer(batchReducer, {
      ...initialBatchState,
      observations: STORY_BATCH,
      nextId: STORY_BATCH.length + 1,
    });
    return (
      <PhoneBatch
        {...args}
        observations={state.observations}
        selected={state.selected}
        dispatch={dispatch}
        onRemove={(o) => dispatch({ type: "remove", id: o.id })}
        onRemoveSelected={() => dispatch({ type: "removeSelected" })}
      />
    );
  },
};
