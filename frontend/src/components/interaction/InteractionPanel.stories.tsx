import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Box } from "@mui/material";
import { InteractionPanel } from "./InteractionPanel";
import {
  ALICE_USER,
  ALICE_PROFILE,
  BOB_PROFILE,
  OAK_OBSERVATION,
} from "../../../../.storybook/fixtures";
import type { InteractionResponse } from "../../services/api";

const SAMPLE_INTERACTIONS: InteractionResponse[] = [
  {
    uri: "at://did:plc:bob/app.observ.interaction/i1",
    cid: "bafyreiint1",
    did: BOB_PROFILE.did,
    subject_a_occurrence_uri: OAK_OBSERVATION.uri,
    subject_a_taxon_name: "Quercus robur",
    subject_a_kingdom: "Plantae",
    subject_b_occurrence_uri: null,
    subject_b_taxon_name: "Cynipidae",
    subject_b_kingdom: "Animalia",
    interaction_type: "parasitism",
    direction: "BtoA",
    comment: "Galls visible on lower leaves.",
    created_at: "2026-04-13T10:00:00Z",
    creator: BOB_PROFILE,
  },
  {
    uri: "at://did:plc:alice/app.observ.interaction/i2",
    cid: "bafyreiint2",
    did: ALICE_PROFILE.did,
    subject_a_occurrence_uri: OAK_OBSERVATION.uri,
    subject_a_taxon_name: "Quercus robur",
    subject_a_kingdom: "Plantae",
    subject_b_occurrence_uri: null,
    subject_b_taxon_name: "Sciurus vulgaris",
    subject_b_kingdom: "Animalia",
    interaction_type: "seed_dispersal",
    direction: "AtoB",
    comment: null,
    created_at: "2026-04-13T11:00:00Z",
    creator: ALICE_PROFILE,
  },
];

const meta = {
  title: "Interaction/InteractionPanel",
  component: InteractionPanel,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    observation: {
      uri: OAK_OBSERVATION.uri,
      cid: OAK_OBSERVATION.cid,
      scientificName: "Quercus robur",
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 480 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof InteractionPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const signedInState = {
  auth: { user: ALICE_USER, isLoading: false },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/interactions/occurrence/*", () => HttpResponse.json({ interactions: [] })),
      ],
    },
  },
};

export const WithInteractions: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/interactions/occurrence/*", () =>
          HttpResponse.json({ interactions: SAMPLE_INTERACTIONS }),
        ),
      ],
    },
  },
};

export const SignedInEmpty: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
    msw: {
      handlers: [
        http.get("/api/interactions/occurrence/*", () => HttpResponse.json({ interactions: [] })),
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/interactions/occurrence/*", async () => {
          await delay("infinite");
          return HttpResponse.json({ interactions: [] });
        }),
      ],
    },
  },
};
