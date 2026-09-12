import type { Meta, StoryObj } from "@storybook/react-vite";
import { List } from "@mui/material";
import NumbersIcon from "@mui/icons-material/Numbers";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { DetailListItem, detailIconSx } from "./DetailListItem";

const meta = {
  title: "Common/DetailListItem",
  component: DetailListItem,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Icon + label + value row used by the observation Details list (quantity, coordinates, …). Centralizes the icon gutter and label/value text treatment so rows can't drift from each other.",
      },
    },
  },
  tags: ["autodocs"],
  args: {
    icon: <NumbersIcon sx={detailIconSx} />,
    primary: "Quantity",
    secondary: "3",
  },
} satisfies Meta<typeof DetailListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <List disablePadding>
      <DetailListItem {...args} />
    </List>
  ),
};

export const MultipleRows: Story = {
  render: () => (
    <List disablePadding>
      <DetailListItem icon={<NumbersIcon sx={detailIconSx} />} primary="Quantity" secondary="3" />
      <DetailListItem
        icon={<MyLocationIcon sx={detailIconSx} />}
        primary="Coordinates"
        secondary="37.77493, -122.41942"
      />
    </List>
  ),
  parameters: {
    docs: {
      description: {
        story: "Each row in the Details list uses the same icon gutter and text treatment.",
      },
    },
  },
};
