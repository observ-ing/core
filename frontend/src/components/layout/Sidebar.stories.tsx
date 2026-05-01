import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sidebar } from "./Sidebar";

/**
 * The Sidebar is a temporary mobile drawer; on desktop viewports it's
 * hidden by an `md: "none"` rule. These stories pin the viewport to
 * mobile so the drawer renders.
 */
const meta = {
  title: "Layout/Sidebar",
  component: Sidebar,
  parameters: {
    layout: "fullscreen",
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  tags: ["autodocs"],
  args: {
    mobileOpen: true,
    onMobileClose: () => undefined,
    unreadCount: 0,
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {};

export const SignedIn: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        auth: {
          user: {
            did: "did:plc:alice",
            handle: "alice.bsky.social",
            displayName: "Alice Botanist",
          },
          isLoading: false,
        },
      },
    },
  },
};

export const SignedInWithUnread: Story = {
  args: {
    mobileOpen: true,
    onMobileClose: () => undefined,
    unreadCount: 7,
  },
  parameters: {
    storeOptions: {
      preloadedState: {
        auth: {
          user: {
            did: "did:plc:alice",
            handle: "alice.bsky.social",
            displayName: "Alice Botanist",
          },
          isLoading: false,
        },
      },
    },
  },
};

export const Closed: Story = {
  args: {
    mobileOpen: false,
    onMobileClose: () => undefined,
    unreadCount: 0,
  },
};
