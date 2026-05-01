import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdatePrompt } from "./UpdatePrompt";

/**
 * The component is driven by `vite-plugin-pwa`'s `useRegisterSW` hook,
 * which is stubbed in Storybook (`.storybook/pwa-register-stub.ts`) to
 * always report no update available. This means the visible "new version"
 * Snackbar can't be exercised here without further wiring; the default
 * story documents that the component mounts without crashing under the
 * stub.
 */
const meta = {
  title: "Common/UpdatePrompt",
  component: UpdatePrompt,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof UpdatePrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoUpdateAvailable: Story = {};
