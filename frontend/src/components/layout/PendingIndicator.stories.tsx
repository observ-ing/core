import type { Meta, StoryObj } from "@storybook/react-vite";
import { PendingIndicator } from "./PendingIndicator";

const meta = {
  title: "Layout/PendingIndicator",
  component: PendingIndicator,
  tags: ["autodocs"],
} satisfies Meta<typeof PendingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

const submission = (n: number, kind: "create" | "update") => ({
  uri: `at://did:plc:demo/bio.lexicons.temp.v0-1.occurrence/demo${n}`,
  cid: `bafyreidemocid${n}`,
  kind,
  createdAt: 0,
});

export const Single: Story = {
  parameters: {
    storeOptions: {
      preloadedState: { pending: { submissions: [submission(1, "create")] } },
    },
  },
};

export const Multiple: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        pending: { submissions: [submission(1, "create"), submission(2, "update")] },
      },
    },
  },
};

export const Empty: Story = {
  parameters: {
    docs: {
      description: { story: "With no submissions in flight, the indicator renders nothing." },
    },
  },
};
