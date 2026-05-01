import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { LocationPicker } from "./LocationPicker";

const meta = {
  title: "Map/LocationPicker",
  component: LocationPicker,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    onChange: () => undefined,
    onUncertaintyChange: () => undefined,
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 600 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof LocationPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    latitude: null,
    longitude: null,
  },
};

export const London: Story = {
  args: {
    latitude: 51.5074,
    longitude: -0.1278,
    uncertaintyMeters: 200,
  },
};

export const SanFranciscoLargeRadius: Story = {
  args: {
    latitude: 37.7749,
    longitude: -122.4194,
    uncertaintyMeters: 10000,
  },
};
