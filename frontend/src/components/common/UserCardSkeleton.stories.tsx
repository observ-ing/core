import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "@mui/material";
import { UserCardSkeleton } from "./UserCardSkeleton";

const meta = {
  title: "Common/UserCardSkeleton",
  component: UserCardSkeleton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    avatarSize: { control: { type: "number" } },
    nameWidth: { control: { type: "text" } },
    nameHeight: { control: { type: "number" } },
    trailingWidth: { control: { type: "text" } },
    subtitleWidth: { control: { type: "text" } },
    subtitleHeight: { control: { type: "number" } },
    spacing: { control: { type: "number" } },
  },
} satisfies Meta<typeof UserCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    nameWidth: "30%",
  },
};

export const WithTrailingAndSubtitle: Story = {
  args: {
    nameWidth: "30%",
    trailingWidth: "20%",
    subtitleWidth: "15%",
  },
};

export const WithEndAdornment: Story = {
  args: {
    avatarSize: 44,
    nameWidth: 120,
    subtitleWidth: 140,
    endAdornment: <Skeleton variant="circular" width={28} height={28} />,
  },
};

export const ProfileHeaderSize: Story = {
  args: {
    avatarSize: 80,
    spacing: 2,
    nameWidth: 180,
    nameHeight: 32,
    subtitleWidth: 120,
    subtitleHeight: 20,
  },
};
