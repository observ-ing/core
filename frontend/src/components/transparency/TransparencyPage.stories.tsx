import type { Meta, StoryObj } from "@storybook/react-vite";
import { TransparencyPage } from "./TransparencyPage";

const meta = {
  title: "Transparency/TransparencyPage",
  component: TransparencyPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TransparencyPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
