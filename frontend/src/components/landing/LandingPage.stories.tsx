import type { Meta, StoryObj } from "@storybook/react-vite";
import { LandingPage } from "./LandingPage";

const meta = {
  title: "Landing/LandingPage",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
