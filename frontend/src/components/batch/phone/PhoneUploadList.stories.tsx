import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneUploadList } from "./PhoneUploadList";
import { STORY_BATCH, phoneFrame } from "./phoneStoryFixtures";

const noop = () => {};
const sendable = STORY_BATCH.slice(0, 3);

const meta = {
  title: "Batch/Phone/PhoneUploadList",
  component: PhoneUploadList,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: {
    observations: sendable.map((o, i) => ({ ...o, status: i === 0 ? "uploading" : "queued" })),
    uploadedCount: 5,
    uploading: true,
    blocked: false,
    profilePath: "/profile/did:plc:alice",
    onCancel: noop,
    onEdit: noop,
    onRetry: noop,
    onRetryAll: noop,
    onRemove: noop,
  },
} satisfies Meta<typeof PhoneUploadList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Uploading: Story = {};

export const FinishedWithFailures: Story = {
  args: {
    uploading: false,
    uploadedCount: 10,
    observations: sendable
      .slice(0, 2)
      .map((o) => ({ ...o, status: "failed", error: "PDS unavailable" })),
  },
};
