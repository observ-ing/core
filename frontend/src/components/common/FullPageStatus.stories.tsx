import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlined";
import { FullPageStatus } from "./FullPageStatus";

const meta = {
  title: "Common/FullPageStatus",
  component: FullPageStatus,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof FullPageStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: <ErrorOutlineIcon sx={{ fontSize: 60, color: "text.disabled" }} />,
    title: "Something went wrong",
    description: "An unexpected error occurred while loading this page.",
    actions: (
      <Button variant="contained" color="primary">
        Reload
      </Button>
    ),
  },
};

export const WithEyebrow: Story = {
  args: {
    icon: <ErrorOutlineIcon sx={{ fontSize: 60, color: "text.disabled" }} />,
    eyebrow: <div style={{ fontSize: "4rem", fontWeight: 700, marginBottom: 8 }}>404</div>,
    title: "Page not found",
    description: "The page you're looking for doesn't exist or has been moved.",
    descriptionMaxWidth: 300,
    actions: (
      <Button variant="contained" color="primary">
        Go home
      </Button>
    ),
  },
};
