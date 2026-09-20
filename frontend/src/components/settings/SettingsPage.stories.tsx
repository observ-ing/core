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
