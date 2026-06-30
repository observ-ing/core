import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { CollapsibleSection } from "./CollapsibleSection";
import { countChipSx } from "./chipSx";

const meta = {
  title: "Common/CollapsibleSection",
  component: CollapsibleSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    title: "Section title",
    children: <Typography variant="body2">Collapsible body content.</Typography>,
  },
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
  args: { defaultExpanded: true },
};

export const WithIconAndCount: Story = {
  args: {
    defaultExpanded: true,
    icon: <InfoOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />,
    trailing: <Chip label={3} size="small" sx={countChipSx} />,
  },
};
