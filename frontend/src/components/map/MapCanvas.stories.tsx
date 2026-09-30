import type { Meta, StoryObj } from "@storybook/react-vite";
import { MapCanvas } from "./MapCanvas";

const meta = {
  title: "Map/MapCanvas",
  component: MapCanvas,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Container shell shared by LocationMap and LocationPicker — the maplibre mount point plus the basemap selector overlay. Renders empty here since no maplibre instance is attached; see LocationMap/LocationPicker for the live map.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MapCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
