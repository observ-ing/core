import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecordOverflowMenu } from "./RecordOverflowMenu";

const meta = {
  title: "Common/RecordOverflowMenu",
  component: RecordOverflowMenu,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    atUri: "at://did:plc:example/ing.observ.occurrence/abc123",
  },
} satisfies Meta<typeof RecordOverflowMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewOnly: Story = {};

export const WithEdit: Story = {
  args: { onEdit: () => {} },
};

export const WithEditAndDelete: Story = {
  args: { onEdit: () => {}, onDelete: () => {} },
};
