import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { BasemapSelector } from "./BasemapSelector";

const meta = {
  title: "Map/BasemapSelector",
  component: BasemapSelector,
  parameters: { layout: "centered" },
  // The selector positions itself absolutely (bottom-left of its map), so give
  // it a relatively-positioned stand-in for the map area.
  decorators: [
    (Story) => (
      <Box
        sx={{
          position: "relative",
          width: 360,
          height: 200,
          bgcolor: "action.hover",
          borderRadius: 1,
        }}
      >
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof BasemapSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
