import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneEditor } from "./PhoneEditor";
import { STORY_BATCH, phoneFrame } from "./phoneStoryFixtures";

const noop = () => {};
const pick = (...ids: string[]) => STORY_BATCH.filter((o) => ids.includes(o.id));

const meta = {
  title: "Batch/Phone/PhoneEditor",
  component: PhoneEditor,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: {
    observations: STORY_BATCH,
    editing: pick("o1"),
    nextIncomplete: { id: "o4", left: 3 },
    onBack: noop,
    onStep: noop,
    onGo: noop,
    onRemove: noop,
  },
} satisfies Meta<typeof PhoneEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {};

export const NeedsLocation: Story = {
  args: { editing: pick("o5"), nextIncomplete: { id: "o6", left: 2 } },
};

/** The last incomplete one: nothing to step on to, so Done is the only way out. */
export const NothingLeft: Story = { args: { editing: pick("o3"), nextIncomplete: null } };

/** Fields the observations disagree on say so; photos are not managed here. */
export const Several: Story = { args: { editing: pick("o1", "o2", "o4"), nextIncomplete: null } };
