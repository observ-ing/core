import type { Meta, StoryObj } from "@storybook/react-vite";
import { BatchUploadPage } from "./BatchUploadPage";
import { ALICE_USER } from "../../../.storybook/fixtures";
import { lowPdsUploadLimitHandler } from "../../../.storybook/handlers";

/**
 * The page starts empty and fills from dropped files, so only the empty state
 * is browsable here; `BatchCard` and `BatchEditor` cover the rest.
 */
const meta = {
  title: "Batch/BatchUploadPage",
  component: BatchUploadPage,
  parameters: {
    layout: "fullscreen",
    storeOptions: { preloadedState: { auth: { user: ALICE_USER, isLoading: false } } },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof BatchUploadPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** A viewer whose PDS accepts smaller photos than the lexicon allows. */
export const EmptyOnLowLimitPds: Story = {
  parameters: { msw: { handlers: [lowPdsUploadLimitHandler] } },
};

export const SignedOut: Story = {
  parameters: { storeOptions: {} },
};
