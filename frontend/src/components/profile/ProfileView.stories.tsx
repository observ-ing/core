import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Routes, Route } from "react-router-dom";
import { ProfileView } from "./ProfileView";
import {
  ALICE_PROFILE,
  OAK_OBSERVATION,
  FERN_OBSERVATION,
  OAK_IDENTIFICATION,
} from "../../../../.storybook/fixtures";

const meta = {
  title: "Profile/ProfileView",
  component: ProfileView,
  parameters: {
    layout: "fullscreen",
    routerInitialEntries: ["/profile/did:plc:alice"],
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Routes>
        <Route path="/profile/:did" element={<Story />} />
      </Routes>
    ),
  ],
} satisfies Meta<typeof ProfileView>;

export default meta;
type Story = StoryObj<typeof meta>;

const populatedFeed = {
  profile: ALICE_PROFILE,
  counts: { observations: 24, identifications: 51, species: 18 },
  occurrences: [OAK_OBSERVATION, FERN_OBSERVATION],
  identifications: [OAK_IDENTIFICATION],
};

const emptyFeed = {
  profile: ALICE_PROFILE,
  counts: { observations: 0, identifications: 0, species: 0 },
  occurrences: [],
  identifications: [],
};

export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/profiles/:did/feed", () => HttpResponse.json(populatedFeed))],
    },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/profiles/:did/feed", () => HttpResponse.json(emptyFeed))],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/profiles/:did/feed", async () => {
          await delay("infinite");
          return HttpResponse.json(emptyFeed);
        }),
      ],
    },
  },
};
