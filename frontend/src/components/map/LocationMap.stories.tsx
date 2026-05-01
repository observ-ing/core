import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { LocationMap } from "./LocationMap";

const meta = {
  title: "Map/LocationMap",
  component: LocationMap,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 600, height: 400 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof LocationMap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const London: Story = {
  args: {
    latitude: 51.5074,
    longitude: -0.1278,
  },
};

export const WithUncertainty: Story = {
  args: {
    latitude: 51.5074,
    longitude: -0.1278,
    uncertaintyMeters: 200,
  },
};

export const LargeUncertainty: Story = {
  args: {
    latitude: 37.7749,
    longitude: -122.4194,
    uncertaintyMeters: 5000,
  },
};

export const InvalidCoordinates: Story = {
  args: {
    latitude: NaN,
    longitude: NaN,
  },
};
