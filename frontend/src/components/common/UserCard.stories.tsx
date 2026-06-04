import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Stack, Typography } from "@mui/material";
import { UserCard } from "./UserCard";

const actor = {
  did: "did:plc:abc123xyz",
  handle: "alice.bsky.social",
  displayName: "Alice Naturalist",
  avatar: "https://i.pravatar.cc/150?img=5",
};

const meta = {
  title: "Common/UserCard",
  component: UserCard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    actor,
  },
  argTypes: {
    showHandle: { control: { type: "boolean" } },
    link: { control: { type: "boolean" } },
    avatarSize: { control: { type: "number" } },
  },
} satisfies Meta<typeof UserCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHandle: Story = {
  args: {
    showHandle: true,
  },
};

export const Linked: Story = {
  args: {
    link: true,
    showHandle: true,
  },
};

export const ProfileHeader: Story = {
  args: {
    avatarSize: 80,
    spacing: 2,
    nameVariant: "h5",
    showHandle: true,
    handleVariant: "body1",
  },
};

export const NoAvatarUsesInitial: Story = {
  args: {
    actor: { did: "did:plc:noavatar", handle: "bob.example.com", displayName: "Bob Birder" },
    showHandle: true,
  },
};

export const HandleOnlyFallback: Story = {
  args: {
    actor: { did: "did:plc:nohandle", handle: "charlie.example.com" },
    showHandle: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          "With no `displayName`, `getDisplayName` falls back to the handle for both the name and the avatar initial.",
      },
    },
  },
};

export const WithTrailingAndBelowName: Story = {
  args: {
    nameVariant: "body2",
    nameSx: { fontWeight: "medium" },
    trailing: (
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        2h ago
      </Typography>
    ),
    belowName: (
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        Nice find — looks like a juvenile to me.
      </Typography>
    ),
    alignItems: "flex-start",
  },
  parameters: {
    docs: {
      description: {
        story:
          "The `trailing` slot sits on the name's baseline row (e.g. a timestamp) and `belowName` renders beneath it (e.g. a comment body).",
      },
    },
  },
};

export const Sizes: Story = {
  render: (args) => (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <UserCard {...args} avatarSize={32} nameVariant="body2" showHandle />
      <UserCard {...args} avatarSize={40} showHandle />
      <UserCard {...args} avatarSize={80} spacing={2} nameVariant="h5" showHandle />
    </Stack>
  ),
};
