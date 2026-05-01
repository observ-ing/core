import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { CommentSection } from "./CommentSection";
import {
  ALICE_USER,
  ALICE_PROFILE,
  OAK_OBSERVATION,
  SAMPLE_COMMENT,
} from "../../../../.storybook/fixtures";
import type { Comment } from "../../services/types";

const REPLY_COMMENT: Comment = {
  commenter: ALICE_PROFILE,
  uri: "at://did:plc:alice/app.observ.comment/c2",
  cid: "bafyreicom2",
  did: ALICE_PROFILE.did,
  subject_uri: OAK_OBSERVATION.uri,
  subject_cid: OAK_OBSERVATION.cid,
  body: "Thanks! The bark texture is the giveaway here.",
  created_at: "2026-04-12T13:00:00Z",
};

const meta = {
  title: "Comment/CommentSection",
  component: CommentSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    observationUri: OAK_OBSERVATION.uri,
    observationCid: OAK_OBSERVATION.cid,
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 480 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof CommentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const signedInState = {
  auth: { user: ALICE_USER, isLoading: false },
};

export const EmptySignedOut: Story = {
  args: { comments: [] },
};

export const EmptySignedIn: Story = {
  args: { comments: [] },
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};

export const WithComments: Story = {
  args: { comments: [SAMPLE_COMMENT, REPLY_COMMENT] },
};

export const WithCommentsSignedIn: Story = {
  args: { comments: [SAMPLE_COMMENT, REPLY_COMMENT] },
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};
