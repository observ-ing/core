import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { KingdomSelect } from "./KingdomSelect";

const meta = {
  title: "Common/KingdomSelect",
  component: KingdomSelect,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 280 }}>
        <Story />
      </Box>
    ),
  ],
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <KingdomSelect {...args} value={value} onChange={setValue} />;
  },
  tags: ["autodocs"],
} satisfies Meta<typeof KingdomSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "",
    onChange: () => undefined,
  },
};

export const Selected: Story = {
  args: {
    value: "Plantae",
    onChange: () => undefined,
  },
};

export const Small: Story = {
  args: {
    value: "",
    onChange: () => undefined,
    size: "small",
  },
};

export const OptionalFilter: Story = {
  args: {
    value: "",
    onChange: () => undefined,
    size: "small",
    required: false,
    emptyOption: { value: "", label: "All Kingdoms" },
    emptyOptionItalic: false,
  },
};
