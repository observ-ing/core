import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { OfflineBanner } from "./OfflineBanner";

/**
 * The component reads `navigator.onLine` and listens for `online`/`offline`
 * events; the `Offline` story flips `navigator.onLine` to `false` and
 * dispatches an `offline` event so the banner mounts.
 */
const meta = {
  title: "Common/OfflineBanner",
  component: OfflineBanner,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof OfflineBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

export const Online: Story = {
  decorators: [
    (Story) => {
      useEffect(() => {
        setOnline(true);
        return () => setOnline(true);
      }, []);
      return <Story />;
    },
  ],
};

export const Offline: Story = {
  decorators: [
    (Story) => {
      useEffect(() => {
        setOnline(false);
        return () => setOnline(true);
      }, []);
      return <Story />;
    },
  ],
};
