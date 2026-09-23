import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageHeader } from "./PageHeader";

const meta = {
  title: "Common/PageHeader",
  component: PageHeader,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Docs",
    subtitle: "Reference material and resources for Observ.ing.",
  },
};

export const TitleOnly: Story = {
  args: {
    title: "Docs",
  },
};
