import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { ConservationStatus } from "./ConservationStatus";
import type { IUCNCategory } from "../../services/types";

const meta = {
  title: "Common/ConservationStatus",
  component: ConservationStatus,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: { type: "object" },
    },
    showLabel: {
      control: { type: "boolean" },
    },
    size: {
      control: { type: "radio" },
      options: ["sm", "md"],
    },
  },
} satisfies Meta<typeof ConservationStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Endangered: Story = {
  args: {
    status: { category: "EN", source: "IUCN" },
    showLabel: true,
  },
};

export const LeastConcern: Story = {
  args: {
    status: { category: "LC", source: "IUCN" },
    showLabel: true,
  },
};

export const AbbreviatedBadge: Story = {
  args: {
    status: { category: "CR", source: "IUCN" },
    showLabel: false,
  },
};

export const SmallSize: Story = {
  args: {
    status: { category: "VU", source: "IUCN" },
    showLabel: true,
    size: "sm",
  },
};

const ALL_CATEGORIES: IUCNCategory[] = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD", "NE"];

export const AllCategories: Story = {
  args: {
    status: { category: "LC", source: "IUCN" },
    showLabel: true,
  },
  render: (args) => (
    <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
      {ALL_CATEGORIES.map((cat) => (
        <ConservationStatus key={cat} {...args} status={{ category: cat, source: "IUCN" }} />
      ))}
    </Stack>
  ),
};
