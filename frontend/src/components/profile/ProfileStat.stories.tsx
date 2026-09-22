import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import GrassIcon from "@mui/icons-material/Grass";
import { ProfileStat } from "./ProfileStat";

const meta = {
  title: "Profile/ProfileStat",
  component: ProfileStat,
  tags: ["autodocs"],
} satisfies Meta<typeof ProfileStat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Observations: Story = {
  args: {
    count: 24,
    color: "primary.main",
    icon: CameraAltIcon,
    label: "Observations",
  },
};

export const Identifications: Story = {
  args: {
    count: 51,
    color: "secondary.main",
    icon: FingerprintIcon,
    label: "IDs",
  },
};

export const Species: Story = {
  args: {
    count: 18,
    color: "success.main",
    icon: GrassIcon,
    label: "Species",
  },
};

export const Row: Story = {
  args: {
    count: 24,
    color: "primary.main",
    icon: CameraAltIcon,
    label: "Observations",
  },
  render: () => (
    <Stack direction="row" spacing={2}>
      <ProfileStat count={24} color="primary.main" icon={CameraAltIcon} label="Observations" />
      <ProfileStat count={51} color="secondary.main" icon={FingerprintIcon} label="IDs" />
      <ProfileStat count={18} color="success.main" icon={GrassIcon} label="Species" />
    </Stack>
  ),
};
