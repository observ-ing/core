import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { RankSelect } from "./RankSelect";

const meta = {
  title: "Common/RankSelect",
  component: RankSelect,
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
    return <RankSelect {...args} value={value} onChange={setValue} />;
  },
  tags: ["autodocs"],
} satisfies Meta<typeof RankSelect>;

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
    value: "genus",
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
