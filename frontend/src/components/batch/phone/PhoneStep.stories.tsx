import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import { PhoneStep } from "./PhoneStep";
import { phoneFrame } from "./phoneStoryFixtures";

const meta = {
  title: "Batch/Phone/PhoneStep",
  component: PhoneStep,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [phoneFrame],
  args: {
    title: "Remarks",
    backLabel: "Back to observation",
    onBack: () => {},
    children: <Typography>The step's own content scrolls here.</Typography>,
  },
} satisfies Meta<typeof PhoneStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};

export const WithWarningAndFooter: Story = {
  args: {
    title: "Observation 5 of 12",
    subtitle: "Missing location",
    subtitleWarns: true,
    footer: (
      <Button variant="contained" startIcon={<CheckIcon />}>
        Done
      </Button>
    ),
  },
};
