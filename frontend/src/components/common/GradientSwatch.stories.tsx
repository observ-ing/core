import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import { GradientSwatch } from "./GradientSwatch";

const meta = {
  title: "Common/GradientSwatch",
  component: GradientSwatch,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    seed: "Vanessa cardui",
  },
} satisfies Meta<typeof GradientSwatch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = {
  args: { seed: "Quercus robur", size: 48 },
};

export const Variety: Story = {
  render: () => (
    <Stack direction="row" spacing={1}>
      {["Animalia", "Arthropoda", "Insecta", "Lepidoptera", "Nymphalidae", "Vanessa"].map((s) => (
        <GradientSwatch key={s} seed={s} size={32} />
      ))}
    </Stack>
  ),
};
