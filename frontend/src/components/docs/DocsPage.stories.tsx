import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocsPage } from "./DocsPage";

const meta = {
  title: "Docs/DocsPage",
  component: DocsPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DocsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
