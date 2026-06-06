import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorBoundary } from "./ErrorBoundary";

// Throws on render so the boundary's fallback UI is what the story shows.
function Boom({ message }: { message: string }): null {
  throw new Error(message);
}

const meta = {
  title: "Common/ErrorBoundary",
  component: ErrorBoundary,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<ComponentProps<typeof ErrorBoundary>>;

export default meta;
type Story = StoryObj<typeof meta>;

// A stale-chunk failure after a redeploy — gets the "Update available" copy.
export const ChunkLoadError: Story = {
  args: {
    children: <Boom message="Failed to fetch dynamically imported module" />,
  },
};

// Any other render error — generic "Something went wrong" copy.
export const GenericError: Story = {
  args: {
    children: <Boom message="Unexpected render failure" />,
  },
};
