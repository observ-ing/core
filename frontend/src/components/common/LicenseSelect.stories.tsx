import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { LicenseSelect } from "./LicenseSelect";
import { DEFAULT_LICENSE } from "../../lib/licenses";

const meta = {
  title: "Common/LicenseSelect",
  component: LicenseSelect,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 320 }}>
        <Story />
      </Box>
    ),
  ],
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <LicenseSelect {...args} value={value} onChange={setValue} />;
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LicenseSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: DEFAULT_LICENSE,
    onChange: () => undefined,
  },
};

export const WithNoneOption: Story = {
  args: {
    value: "__none__",
    onChange: () => undefined,
    label: "Default license",
    noneOption: { value: "__none__", label: "No default (use CC BY)" },
  },
};

export const Small: Story = {
  args: {
    value: DEFAULT_LICENSE,
    onChange: () => undefined,
    size: "small",
  },
};

export const Disabled: Story = {
  args: {
    value: DEFAULT_LICENSE,
    onChange: () => undefined,
    disabled: true,
  },
};
