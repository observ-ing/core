import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { SettingsPage } from "./SettingsPage";
import { ALICE_USER } from "../../../.storybook/fixtures";

const meta = {
  title: "Settings/SettingsPage",
  component: SettingsPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const signedInState = {
  auth: { user: ALICE_USER, isLoading: false },
};

export const Default: Story = {};

// Signed out only shows the theme toggle. The "Upload defaults" section below
// only renders for a signed-in user, so it's otherwise never exercised here.
export const SignedIn: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
    msw: {
      handlers: [
        http.get("/api/user/preferences", () =>
          HttpResponse.json({ defaultLicense: null, basemap: null }),
        ),
      ],
    },
  },
};

const preferencesHandler = http.get("/api/user/preferences", () =>
  HttpResponse.json({ defaultLicense: null, basemap: null }),
);

// The iNaturalist section only renders when the server has cross-posting
// enabled, so the stories above never show it.
export const SignedInWithInaturalistUnlinked: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
    msw: {
      handlers: [
        preferencesHandler,
        http.get("/api/inat/account", () =>
          HttpResponse.json({ enabled: true, login: null, linkedAt: null }),
        ),
      ],
    },
  },
};

export const SignedInWithInaturalistLinked: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
    msw: {
      handlers: [
        preferencesHandler,
        http.get("/api/inat/account", () =>
          HttpResponse.json({ enabled: true, login: "alice", linkedAt: "2026-10-07T00:00:00Z" }),
        ),
      ],
    },
  },
};

export const SignedInWithDefaultLicense: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
    msw: {
      handlers: [
        http.get("/api/user/preferences", () =>
          HttpResponse.json({ defaultLicense: "CC0-1.0", basemap: null }),
        ),
      ],
    },
  },
};
