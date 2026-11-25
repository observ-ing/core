import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConvertingStatus } from "./ConvertingStatus";

const meta = {
  title: "Batch/ConvertingStatus",
  component: ConvertingStatus,
  tags: ["autodocs"],
  args: { count: 3 },
} satisfies Meta<typeof ConvertingStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Beside the desktop uploader header and on the phone start screen. */
export const Default: Story = {};

/** Single photo: singular label. */
export const OnePhoto: Story = { args: { count: 1 } };

/** Among the phone grid's filter chips, at the chips' smaller text size. */
export const Body2: Story = { args: { variant: "body2" } };

/** Nothing left to convert: renders nothing. */
export const Done: Story = { args: { count: 0 } };
