import type { Meta, StoryObj } from "@storybook/react-vite";
import { Typography } from "@mui/material";
import { ConfirmDialog } from "./ConfirmDialog";

const meta = {
  title: "Common/ConfirmDialog",
  component: ConfirmDialog,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    open: true,
    onConfirm: () => undefined,
    onCancel: () => undefined,
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Save changes?",
    message: "Your changes will be applied immediately.",
    confirmLabel: "Save",
  },
};

export const Destructive: Story = {
  args: {
    title: "Delete Observation?",
    confirmLabel: "Delete",
    destructive: true,
    children: (
      <>
        <Typography>
          Are you sure you want to delete this observation of <strong>Larus argentatus</strong>?
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
          This action cannot be undone. All identifications and comments will also be deleted.
        </Typography>
      </>
    ),
  },
};

export const Loading: Story = {
  args: {
    title: "Delete Observation?",
    message: "Are you sure you want to delete this observation?",
    confirmLabel: "Delete",
    pendingLabel: "Deleting...",
    destructive: true,
    pending: true,
  },
};
