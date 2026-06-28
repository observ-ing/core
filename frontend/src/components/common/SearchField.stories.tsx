import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { SearchField } from "./SearchField";

const meta = {
  title: "Common/SearchField",
  component: SearchField,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    label: "Search",
    placeholder: "Search taxa",
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 320 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Controlled: Story = {
  render: (args) => {
    const [value, setValue] = useState("");
    return <SearchField {...args} value={value} onChange={(e) => setValue(e.target.value)} />;
  },
};

export const Small: Story = {
  args: { size: "small" },
};
