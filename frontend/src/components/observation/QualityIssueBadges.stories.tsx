import type { Meta, StoryObj } from "@storybook/react-vite";
import { QualityIssueBadges } from "./QualityIssueBadges";

const meta = {
  title: "Observation/QualityIssueBadges",
  component: QualityIssueBadges,
  tags: ["autodocs"],
} satisfies Meta<typeof QualityIssueBadges>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoIssues: Story = {
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

export const AllIssues: Story = {
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
