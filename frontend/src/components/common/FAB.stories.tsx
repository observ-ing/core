import type { Meta, StoryObj } from "@storybook/react-vite";
import { FAB } from "./FAB";

const meta = {
  title: "Common/FAB",
  component: FAB,
  parameters: {
    layout: "fullscreen",
    // Wide screens get the top bar's CreateMenu instead, and the FAB hides.
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof FAB>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        auth: {
          user: {
            did: "did:plc:test",
            handle: "test.bsky.social",
            displayName: "Test User",
          },
          isLoading: false,
        },
      },
    },
  },
};

export const SignedOut: Story = {
  parameters: {
    docs: {
      description: {
        story: "When no user is authenticated, the FAB renders nothing.",
      },
    },
  },
};
