import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { FeedItem } from "./FeedItem";
import { ALICE_USER, OAK_OBSERVATION, FERN_OBSERVATION } from "../../../../.storybook/fixtures";

const meta = {
  title: "Feed/FeedItem",
  component: FeedItem,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof FeedItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const signedInState = {
  auth: { user: ALICE_USER, isLoading: false },
};

export const SignedOut: Story = {
  args: {
    observation: OAK_OBSERVATION,
  },
};

export const OwnPostWithEdit: Story = {
  args: {
    observation: OAK_OBSERVATION,
    onEdit: () => undefined,
    onDelete: () => undefined,
  },
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};

export const Liked: Story = {
  args: {
    observation: { ...OAK_OBSERVATION, viewerHasLiked: true, likeCount: 12 },
  },
  parameters: {
    storeOptions: { preloadedState: signedInState },
    msw: {
      handlers: [
        http.post("/api/likes", () => HttpResponse.json({ success: true })),
        http.delete("/api/likes/*", () => HttpResponse.json({ success: true })),
      ],
    },
  },
};

export const OtherUserPost: Story = {
  args: {
    observation: FERN_OBSERVATION,
  },
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};
