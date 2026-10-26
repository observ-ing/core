import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneStart } from "./PhoneStart";
import { phoneFrame } from "./phoneStoryFixtures";
import { ALICE_USER } from "../../../../.storybook/fixtures";
import { lowPdsUploadLimitHandler } from "../../../../.storybook/handlers";

const meta = {
  title: "Batch/Phone/PhoneStart",
  component: PhoneStart,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: { onChoosePhotos: () => {}, converting: 0, stripsLocation: false },
} satisfies Meta<typeof PhoneStart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** An Android browser, which hands photos over without their GPS position. */
export const LocationStripped: Story = { args: { stripsLocation: true } };

export const ConvertingHeic: Story = { args: { converting: 3 } };

/** A viewer whose PDS accepts smaller photos than the lexicon allows. */
export const LowLimitPds: Story = {
  parameters: {
    storeOptions: { preloadedState: { auth: { user: ALICE_USER, isLoading: false } } },
    msw: { handlers: [lowPdsUploadLimitHandler] },
  },
};
