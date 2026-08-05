import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { UserAvatar } from "./UserAvatar";

const meta = {
  title: "Common/UserAvatar",
  component: UserAvatar,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    did: "did:plc:abc123xyz",
    handle: "alice.bsky.social",
    displayName: "Alice Naturalist",
    src: "https://i.pravatar.cc/150?img=5",
    size: 40,
  },
  argTypes: {
    size: { control: { type: "number" } },
  },
} satisfies Meta<typeof UserAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FallbackGradient: Story = {
  args: {
    src: undefined,
  },
};

export const LargerSize: Story = {
  args: {
    src: undefined,
    size: 80,
  },
};

export const Sizes: Story = {
  render: (args) => (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
      <UserAvatar {...args} src={undefined} size={32} />
      <UserAvatar {...args} src={undefined} size={40} />
      <UserAvatar {...args} src={undefined} size={80} />
    </Stack>
  ),
};
