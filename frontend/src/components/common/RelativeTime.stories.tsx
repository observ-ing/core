import type { Meta, StoryObj } from "@storybook/react-vite";
import { RelativeTime } from "./RelativeTime";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const hoursAgo = (h: number) => minutesAgo(h * 60);
const daysAgo = (d: number) => hoursAgo(d * 24);

const meta = {
  title: "Common/RelativeTime",
  component: RelativeTime,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    withAgo: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof RelativeTime>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FiveMinutesAgo: Story = {
  args: {
    date: minutesAgo(5),
  },
};

export const TwoHoursAgo: Story = {
  args: {
    date: hoursAgo(2),
  },
};

export const ThreeDaysAgo: Story = {
  args: {
    date: daysAgo(3),
  },
};

export const WithAgoSuffix: Story = {
  args: {
    date: hoursAgo(2),
    withAgo: true,
  },
};
