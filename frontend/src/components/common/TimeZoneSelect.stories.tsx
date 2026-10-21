import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { TimeZoneSelect } from "./TimeZoneSelect";

const meta = {
  title: "Common/TimeZoneSelect",
  component: TimeZoneSelect,
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
    // Choosing a zone gives the whole selection that one.
    const [mixed, setMixed] = useState(args.mixed ?? false);
    return (
      <TimeZoneSelect
        {...args}
        value={value}
        mixed={mixed}
        onChange={(offset) => {
          setValue(offset);
          setMixed(false);
        }}
      />
    );
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TimeZoneSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LocalTime: Story = {
  args: {
    value: null,
    date: "2026-10-03T10:42",
    onChange: () => undefined,
  },
};

export const FromPhoto: Story = {
  args: {
    value: "-07:00",
    date: "2026-10-03T10:42",
    onChange: () => undefined,
  },
};

/** An offset no zone uses today, as an old or misconfigured camera can record. */
export const UnusualOffset: Story = {
  args: {
    value: "+01:23",
    date: "2026-10-03T10:42",
    onChange: () => undefined,
  },
};

export const Mixed: Story = {
  args: {
    value: "-07:00",
    date: "",
    mixed: true,
    extraOffsets: ["-07:00", "+09:00"],
    onChange: () => undefined,
  },
};
