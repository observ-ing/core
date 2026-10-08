import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { InatSettings } from "./InatSettings";
import { ALICE_USER } from "../../../.storybook/fixtures";

// The section asks the server about the signed-in user's linked account, so
// every story needs a user and an /api/inat/account response.
const signedIn = {
  storeOptions: { preloadedState: { auth: { user: ALICE_USER, isLoading: false } } },
};

const account = (body: { enabled: boolean; login: string | null; linkedAt: string | null }) => ({
  handlers: [http.get("/api/inat/account", () => HttpResponse.json(body))],
});

const meta = {
  title: "Settings/InatSettings",
  component: InatSettings,
  tags: ["autodocs"],
} satisfies Meta<typeof InatSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = {
  parameters: {
    ...signedIn,
    msw: account({ enabled: true, login: null, linkedAt: null }),
  },
};

export const Connected: Story = {
  parameters: {
    ...signedIn,
    msw: account({ enabled: true, login: "alice", linkedAt: "2026-10-07T00:00:00Z" }),
  },
};

// Renders nothing: the server has no iNaturalist application configured.
export const TurnedOff: Story = {
  parameters: {
    ...signedIn,
    msw: account({ enabled: false, login: null, linkedAt: null }),
  },
};
