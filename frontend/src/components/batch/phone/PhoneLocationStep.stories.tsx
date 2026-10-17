import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneLocationStep } from "./PhoneLocationStep";
import { STORY_BATCH, phoneFrame } from "./phoneStoryFixtures";

const meta = {
  title: "Batch/Phone/PhoneLocationStep",
  component: PhoneLocationStep,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: { observations: STORY_BATCH.slice(0, 1), onApply: () => {}, onBack: () => {} },
} satisfies Meta<typeof PhoneLocationStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Located: Story = {};

export const NoLocation: Story = { args: { observations: STORY_BATCH.slice(4, 5) } };

/** Where the others already are is shown in grey; one tap proposes a place for all. */
export const Several: Story = { args: { observations: STORY_BATCH.slice(2, 5) } };
