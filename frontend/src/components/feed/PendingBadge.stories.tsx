import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { PendingBadge } from "./PendingBadge";

const meta = {
  title: "Feed/PendingBadge",
  component: PendingBadge,
  parameters: {
    layout: "padded",
  },
  // The badge is absolutely positioned, so anchor it to a relative box sized
  // like the corner of a feed card it overlays.
  decorators: [
    (Story) => (
      <Box
        sx={{
          position: "relative",
          width: 280,
          height: 120,
          bgcolor: "placeholder",
          borderRadius: 1,
        }}
      >
        <Story />
      </Box>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof PendingBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
