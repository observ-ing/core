import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataQualitySection } from "./DataQualitySection";

const meta = {
  title: "Observation/DataQualitySection",
  component: DataQualitySection,
  tags: ["autodocs"],
} satisfies Meta<typeof DataQualitySection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllMet: Story = {
  args: { issues: [] },
};

export const MissingMedia: Story = {
  args: { issues: ["MISSING_MEDIA"] },
};

export const MissingConsensus: Story = {
  args: { issues: ["NO_CONSENSUS_ID"] },
};

export const Multiple: Story = {
  args: { issues: ["MISSING_DATE", "COORDINATES_IMPRECISE", "NO_CONSENSUS_ID"] },
};

export const NoneMet: Story = {
  args: {
    issues: [
      "MISSING_DATE",
      "MISSING_LOCATION",
      "MISSING_MEDIA",
      "COORDINATES_IMPRECISE",
      "NO_CONSENSUS_ID",
    ],
  },
};
