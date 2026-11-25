import type { Meta, StoryObj } from "@storybook/react-vite";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ScheduleIcon from "@mui/icons-material/Schedule";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { captionIconSx, miniIconSx } from "../common/layoutSx";
import { StatusLine } from "./StatusLine";

const meta = {
  title: "Batch/StatusLine",
  component: StatusLine,
  tags: ["autodocs"],
  args: { icon: <ScheduleIcon sx={captionIconSx} />, children: "Queued" },
} satisfies Meta<typeof StatusLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Waiting to upload on a desktop batch card: inherits the card's text color. */
export const Queued: Story = {};

/** Upload finished on a desktop batch card. */
export const Uploaded: Story = {
  args: {
    icon: <CheckCircleIcon sx={captionIconSx} />,
    color: "success.main",
    children: "Uploaded",
  },
};

/** Upload failed on a desktop batch card. */
export const Failed: Story = {
  args: {
    icon: <ErrorIcon sx={captionIconSx} />,
    color: "error.main",
    children: "Upload failed",
  },
};

/** Missing-field warning on a phone grid tile, at caption size. */
export const PhoneTileWarning: Story = {
  args: {
    variant: "caption",
    icon: <WarningAmberIcon sx={miniIconSx} />,
    color: "warning.main",
    children: "Needs a location",
  },
};

/** Failed-count summary in the desktop uploader header, at body1 size with a wider gap. */
export const HeaderFailedCount: Story = {
  args: {
    variant: "body1",
    icon: <ErrorIcon fontSize="small" />,
    color: "error.main",
    children: "2 failed",
  },
};
