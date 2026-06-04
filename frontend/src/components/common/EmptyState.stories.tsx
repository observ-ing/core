import type { Meta, StoryObj } from "@storybook/react-vite";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Common/EmptyState",
  component: EmptyState,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    p: { control: { type: "number" } },
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    message: "No observations yet. Be the first to post!",
  },
};

export const NoActivity: Story = {
  args: {
    message: "No activity yet",
  },
};

export const WithIcon: Story = {
  args: {
    message: "No observations yet. Be the first to post!",
    icon: <CameraAltIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />,
  },
};
