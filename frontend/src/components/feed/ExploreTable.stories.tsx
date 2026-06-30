import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { ExploreTable } from "./ExploreTable";
import { OAK_OBSERVATION, FERN_OBSERVATION } from "../../../.storybook/fixtures";
import type { Occurrence } from "../../services/types";

// A row exercising the "needs work" path: quality issues (rendered as the
// warning chip), an organism quantity, and an imprecise location.
const PARTIAL_OBSERVATION: Occurrence = {
  ...FERN_OBSERVATION,
  uri: "at://did:plc:bob/app.observ.occurrence/fern2",
  cid: "bafyreifern2",
  organismQuantity: "12",
  organismQuantityType: "individuals",
  location: { latitude: 51.51, longitude: -0.13, uncertaintyMeters: 4000 },
  likeCount: 8,
  qualityIssues: ["MISSING_MEDIA", "COORDINATES_IMPRECISE"],
};

// A barely-identified row: no taxonomy and no location, so most cells fall
// back to the em-dash placeholder.
const {
  effectiveTaxonomy: _dropTax,
  location: _dropLoc,
  ...UNIDENTIFIED_OBSERVATION
} = {
  ...OAK_OBSERVATION,
  uri: "at://did:plc:alice/app.observ.occurrence/oak2",
  cid: "bafyreioak2",
  identificationCount: 0,
  qualityIssues: ["MISSING_MEDIA", "NO_CONSENSUS_ID"],
} satisfies Occurrence;
void _dropTax;
void _dropLoc;

const meta = {
  title: "Feed/ExploreTable",
  component: ExploreTable,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ overflowX: "auto", bgcolor: "background.default", p: 2 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof ExploreTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    observations: [
      OAK_OBSERVATION,
      FERN_OBSERVATION,
      PARTIAL_OBSERVATION,
      UNIDENTIFIED_OBSERVATION,
    ],
  },
};

export const Empty: Story = {
  args: {
    observations: [],
  },
  parameters: {
    docs: {
      description: {
        story: "With no observations the table renders just its header row.",
      },
    },
  },
};
