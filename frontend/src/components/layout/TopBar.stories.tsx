import type { Meta, StoryObj } from "@storybook/react-vite";
import { TopBar } from "./TopBar";
import { ALICE_USER } from "../../../../.storybook/fixtures";

const meta = {
  title: "Layout/TopBar",
  component: TopBar,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    onMobileMenuClick: () => undefined,
    unreadCount: 0,
  },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const signedInState = {
  auth: {
    user: ALICE_USER,
    isLoading: false,
  },
};

export const SignedOut: Story = {
  parameters: {
    storeOptions: {
      preloadedState: { auth: { user: null, isLoading: false } },
    },
  },
};

export const SignedIn: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};

export const SignedInWithUnread: Story = {
  args: {
    onMobileMenuClick: () => undefined,
    unreadCount: 5,
  },
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};

export const Loading: Story = {
  parameters: {
    storeOptions: {
      preloadedState: { auth: { user: null, isLoading: true } },
    },
  },
};
