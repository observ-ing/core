import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { ObservationGridCard } from "./ObservationGridCard";
import { PendingBadge } from "../feed/PendingBadge";
import { OAK_OBSERVATION, FERN_OBSERVATION } from "../../../.storybook/fixtures";

const meta = {
  title: "Common/ObservationGridCard",
  component: ObservationGridCard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 280 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof ObservationGridCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Oak: Story = {
  args: {
    observation: OAK_OBSERVATION,
  },
};

export const Fern: Story = {
  args: {
    observation: FERN_OBSERVATION,
  },
};

export const Pending: Story = {
  args: {
    observation: OAK_OBSERVATION,
    isPending: true,
    badge: <PendingBadge />,
  },
  parameters: {
    docs: {
      description: {
        story:
          "An optimistic submission awaiting ingestion: dimmed, navigation-blocked, and badged (used by the feed's ExploreGridCard).",
      },
    },
  },
};

const { effectiveTaxonomy: _drop, ...noTaxonomyObservation } = OAK_OBSERVATION;
void _drop;

export const NoTaxonomy: Story = {
  args: {
    observation: noTaxonomyObservation,
  },
  parameters: {
    docs: {
      description: {
        story:
          "When an observation hasn't been identified yet, the card falls back to a placeholder caption.",
      },
    },
  },
};
