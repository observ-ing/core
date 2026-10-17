import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneStart } from "./PhoneStart";
import { phoneFrame } from "./phoneStoryFixtures";

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
