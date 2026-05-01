import type { Meta, StoryObj } from "@storybook/react-vite";
import { LexiconView } from "./LexiconView";

const meta = {
  title: "Lexicon/LexiconView",
  component: LexiconView,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LexiconView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
