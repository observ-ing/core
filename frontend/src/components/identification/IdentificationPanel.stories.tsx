import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { IdentificationPanel } from "./IdentificationPanel";
import { OAK_OBSERVATION } from "../../../../.storybook/fixtures";

const meta = {
  title: "Identification/IdentificationPanel",
  component: IdentificationPanel,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 480 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof IdentificationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    observation: {
      uri: OAK_OBSERVATION.uri,
      cid: OAK_OBSERVATION.cid,
      scientificName: "Quercus robur",
    },
  },
};

export const WithImage: Story = {
  args: {
    observation: {
      uri: OAK_OBSERVATION.uri,
      cid: OAK_OBSERVATION.cid,
      scientificName: "Quercus robur",
    },
    imageUrl: OAK_OBSERVATION.images[0] ?? "",
    latitude: 51.5074,
    longitude: -0.1278,
  },
};

export const Unidentified: Story = {
  args: {
    observation: {
      uri: OAK_OBSERVATION.uri,
      cid: OAK_OBSERVATION.cid,
    },
  },
};
