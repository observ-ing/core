import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@mui/material";
import { SettingsSection } from "./SettingsSection";

const meta = {
  title: "Settings/SettingsSection",
  component: SettingsSection,
  tags: ["autodocs"],
} satisfies Meta<typeof SettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Appearance",
    description: "Choose how Observ.ing looks to you.",
    children: <Button variant="outlined">A control</Button>,
  },
};

export const LongDescription: Story = {
  args: {
    title: "iNaturalist",
    description:
      "Connect your iNaturalist account to post observations there too. Each one is posted " +
      "once: later edits here don't change it there, and nothing comes back from iNaturalist.",
    children: <Button variant="contained">Connect iNaturalist</Button>,
  },
};
