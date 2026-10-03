import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { SpeciesIdProgress } from "./SpeciesIdProgress";

const meta = {
  title: "Identification/SpeciesIdProgress",
  component: SpeciesIdProgress,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 400 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof SpeciesIdProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Service is warm: a plain pending indicator. */
export const Warm: Story = {
  args: { readyAt: null },
};

/** Service is booting from zero: counts down the estimated wait. */
export const ColdStart: Story = {
  args: { readyAt: Date.now() + 20_000 },
};

/** On the live camera's dark overlay. */
export const OnDarkOverlay: Story = {
  args: { readyAt: Date.now() + 12_000, color: "common.white" },
  decorators: [
    (Story) => (
      <Box sx={{ bgcolor: "common.black", p: 2 }}>
        <Story />
      </Box>
    ),
  ],
};
