import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Chip, List, Stack, Typography } from "@mui/material";
import { RecordListItem } from "./RecordListItem";

const actor = {
  did: "did:plc:abc123xyz",
  handle: "alice.bsky.social",
  displayName: "Alice Naturalist",
  avatar: "https://i.pravatar.cc/150?img=5",
};

const meta = {
  title: "Common/RecordListItem",
  component: RecordListItem,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Left-accent row for a record's history/discussion feed: avatar + author, relative timestamp, optional status badges, and an overflow menu. Shared by `CommentSection` and `IdentificationHistory` so the two feeds can't drift apart.",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <List disablePadding sx={{ maxWidth: 480 }}>
          <Story />
        </List>
      </MemoryRouter>
    ),
  ],
  args: {
    actor,
    linkDid: actor.did,
    date: new Date(Date.now() - 2 * 60 * 60 * 1000),
    atUri: "at://did:plc:abc123xyz/app.bsky.feed.post/abc",
    borderColor: "divider",
    belowName: null,
  },
} satisfies Meta<typeof RecordListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Comment: Story = {
  args: {
    hoverBorderColor: "primary.main",
    belowName: (
      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
        Nice find — looks like a juvenile to me.
      </Typography>
    ),
  },
};

export const Identification: Story = {
  args: {
    borderColor: "primary.main",
    badges: <Chip label="Observer's ID" size="small" color="info" variant="outlined" />,
    belowName: (
      <Typography variant="body1" sx={{ mt: 0.5, fontStyle: "italic" }}>
        Turdus migratorius
      </Typography>
    ),
  },
};

export const Superseded: Story = {
  args: {
    borderColor: "text.disabled",
    opacity: 0.5,
    badges: <Chip label="Superseded" size="small" variant="outlined" />,
    belowName: (
      <Typography
        variant="body1"
        sx={{ mt: 0.5, fontStyle: "italic", textDecoration: "line-through" }}
      >
        Turdus americanus
      </Typography>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          "A dimmed row for an identification that's been superseded by a newer one from the same user.",
      },
    },
  },
};

export const WithDeleteOption: Story = {
  args: {
    onDelete: () => {},
    belowName: (
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        The overflow menu shows a "Delete" item when `onDelete` is provided.
      </Typography>
    ),
  },
};

export const Feed: Story = {
  render: () => (
    <Stack spacing={2}>
      <RecordListItem
        actor={actor}
        linkDid={actor.did}
        date={new Date(Date.now() - 30 * 60 * 1000)}
        atUri="at://did:plc:abc123xyz/app.bsky.feed.post/abc"
        borderColor="primary.main"
        badges={<Chip label="Observer's ID" size="small" color="info" variant="outlined" />}
        belowName={
          <Typography variant="body1" sx={{ mt: 0.5, fontStyle: "italic" }}>
            Turdus migratorius
          </Typography>
        }
      />
      <RecordListItem
        actor={{ did: "did:plc:def456", handle: "bob.example.com", displayName: "Bob Birder" }}
        linkDid="did:plc:def456"
        date={new Date(Date.now() - 90 * 60 * 1000)}
        atUri="at://did:plc:def456/app.bsky.feed.post/def"
        borderColor="text.disabled"
        opacity={0.5}
        badges={<Chip label="Superseded" size="small" variant="outlined" />}
        belowName={
          <Typography
            variant="body1"
            sx={{ mt: 0.5, fontStyle: "italic", textDecoration: "line-through" }}
          >
            Turdus americanus
          </Typography>
        }
      />
    </Stack>
  ),
  parameters: {
    docs: {
      description: {
        story: "Multiple rows as they appear stacked in an `IdentificationHistory` list.",
      },
    },
  },
};
