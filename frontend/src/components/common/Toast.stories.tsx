import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToastContainer } from "./Toast";
import { addToast } from "../../store/uiSlice";

const meta = {
  title: "Common/Toast",
  component: ToastContainer,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ToastContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  parameters: {
    storeOptions: {
      actions: [addToast({ message: "Observation saved", type: "success" })],
    },
  },
};

export const Error: Story = {
  parameters: {
    storeOptions: {
      actions: [addToast({ message: "Failed to upload — please try again", type: "error" })],
    },
  },
};

export const Empty: Story = {
  parameters: {
    docs: {
      description: {
        story: "With no toasts queued, the container renders nothing.",
      },
    },
  },
};
