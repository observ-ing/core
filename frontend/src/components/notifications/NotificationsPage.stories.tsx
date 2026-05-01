import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { NotificationsPage } from "./NotificationsPage";
import { BOB_PROFILE, OAK_OBSERVATION } from "../../../../.storybook/fixtures";
import type { Notification } from "../../services/types";

const NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    actorDid: BOB_PROFILE.did,
    kind: "like",
    subjectUri: OAK_OBSERVATION.uri,
    read: false,
    createdAt: "2026-04-12T13:00:00Z",
    actor: BOB_PROFILE,
  },
  {
    id: 2,
    actorDid: BOB_PROFILE.did,
    kind: "comment",
    subjectUri: OAK_OBSERVATION.uri,
    referenceUri: "at://did:plc:bob/app.observ.comment/c1",
    read: false,
    createdAt: "2026-04-11T09:00:00Z",
    actor: BOB_PROFILE,
  },
  {
    id: 3,
    actorDid: BOB_PROFILE.did,
    kind: "identification",
    subjectUri: OAK_OBSERVATION.uri,
    read: true,
    createdAt: "2026-04-09T16:00:00Z",
    actor: BOB_PROFILE,
  },
];

const meta = {
  title: "Notifications/NotificationsPage",
  component: NotificationsPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof NotificationsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/notifications", () => HttpResponse.json({ notifications: NOTIFICATIONS })),
      ],
    },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/notifications", () => HttpResponse.json({ notifications: [] }))],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/notifications", async () => {
          await delay("infinite");
          return HttpResponse.json({ notifications: [] });
        }),
      ],
    },
  },
};
