import type { Meta, StoryObj } from "@storybook/react-vite";
import { Typography } from "@mui/material";
import { PageContainer } from "./PageContainer";

const meta = {
  title: "Common/PageContainer",
  component: PageContainer,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PageContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    maxWidth: "sm",
    children: (
      <>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Page title
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Page content goes here.
        </Typography>
      </>
    ),
  },
};

export const MediumWidth: Story = {
  args: {
    ...Default.args,
    maxWidth: "md",
  },
};
