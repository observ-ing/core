import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Typography, Button, Stack } from "@mui/material";
import { ModalOverlay } from "./ModalOverlay";

const meta = {
  title: "Modals/ModalOverlay",
  component: ModalOverlay,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    onClose: () => undefined,
  },
} satisfies Meta<typeof ModalOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleContent = (
  <Stack spacing={2}>
    <Typography variant="h6">Modal title</Typography>
    <Typography variant="body2">
      This is a generic modal overlay you can drop arbitrary content into.
    </Typography>
    <Box>
      <Button variant="contained">Confirm</Button>
    </Box>
  </Stack>
);

export const Closed: Story = {
  args: {
    isOpen: false,
    children: sampleContent,
  },
};

export const Open: Story = {
  args: {
    isOpen: true,
    children: sampleContent,
  },
};

export const WideModal: Story = {
  args: {
    isOpen: true,
    maxWidth: "md",
    children: sampleContent,
  },
};
