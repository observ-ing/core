import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Button } from "@mui/material";
import { IdentificationHistory } from "./IdentificationHistory";
import { ALICE_PROFILE, BOB_PROFILE, OAK_IDENTIFICATION } from "../../../../.storybook/fixtures";
import type { Identification } from "../../services/types";

const BOB_ID: Identification = {
  identifier: BOB_PROFILE,
  uri: "at://did:plc:bob/app.observ.identification/id2",
  cid: "bafyreiid2",
  did: BOB_PROFILE.did,
  subject_uri: OAK_IDENTIFICATION.subject_uri,
  subject_cid: OAK_IDENTIFICATION.subject_cid,
  scientific_name: "Quercus robur",
  taxon_rank: "species",
  date_identified: "2026-04-13T09:00:00Z",
  kingdom: "Plantae",
  family: "Fagaceae",
  genus: "Quercus",
  is_agreement: true,
};

const SUPERSEDED_ALICE_ID: Identification = {
  identifier: ALICE_PROFILE,
  uri: "at://did:plc:alice/app.observ.identification/id_old",
  cid: "bafyreiidold",
  did: ALICE_PROFILE.did,
  subject_uri: OAK_IDENTIFICATION.subject_uri,
  subject_cid: OAK_IDENTIFICATION.subject_cid,
  scientific_name: "Quercus",
  taxon_rank: "genus",
  date_identified: "2026-04-12T10:00:00Z",
  kingdom: "Plantae",
};

const meta = {
  title: "Identification/IdentificationHistory",
  component: IdentificationHistory,
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
} satisfies Meta<typeof IdentificationHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { identifications: [] },
};

export const SingleIdentification: Story = {
  args: {
    identifications: [OAK_IDENTIFICATION],
    observerDid: ALICE_PROFILE.did,
  },
};

export const MultipleAgreements: Story = {
  args: {
    identifications: [OAK_IDENTIFICATION, BOB_ID],
    observerDid: ALICE_PROFILE.did,
  },
};

export const WithSupersededIds: Story = {
  args: {
    identifications: [SUPERSEDED_ALICE_ID, OAK_IDENTIFICATION, BOB_ID],
    observerDid: ALICE_PROFILE.did,
  },
};

export const WithFooter: Story = {
  args: {
    identifications: [OAK_IDENTIFICATION],
    footer: (
      <Box sx={{ mt: 2 }}>
        <Button variant="outlined" size="small">
          Add identification
        </Button>
      </Box>
    ),
  },
};

export const WithDeleteOnOwn: Story = {
  args: {
    identifications: [OAK_IDENTIFICATION, BOB_ID],
    observerDid: ALICE_PROFILE.did,
    currentUserDid: ALICE_PROFILE.did,
    onDeleteIdentification: async () => undefined,
  },
};
