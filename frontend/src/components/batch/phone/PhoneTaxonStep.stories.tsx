import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneTaxonStep } from "./PhoneTaxonStep";
import { STORY_BATCH, phoneFrame } from "./phoneStoryFixtures";

const meta = {
  title: "Batch/Phone/PhoneTaxonStep",
  component: PhoneTaxonStep,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: { observations: STORY_BATCH.slice(1, 2), onChoose: () => {}, onBack: () => {} },
} satisfies Meta<typeof PhoneTaxonStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing typed: suggestions from the first photo are there for the asking. */
export const Unidentified: Story = {};

export const Identified: Story = { args: { observations: STORY_BATCH.slice(0, 1) } };

/** Suggestions are for one photo, so several observations only get the search. */
export const Several: Story = { args: { observations: STORY_BATCH.slice(0, 3) } };
