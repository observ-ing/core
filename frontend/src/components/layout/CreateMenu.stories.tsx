import type { Meta, StoryObj } from "@storybook/react-vite";
import { CreateMenu } from "./CreateMenu";
import { ALICE_USER } from "../../../.storybook/fixtures";

const meta = {
  title: "Layout/CreateMenu",
  component: CreateMenu,
  tags: ["autodocs"],
} satisfies Meta<typeof CreateMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const signedInState = {
  auth: {
    user: ALICE_USER,
    isLoading: false,
  },
};

export const SignedIn: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};

export const SignedOut: Story = {
  parameters: {
    docs: {
      description: {
        story: "When no user is authenticated, the button renders nothing.",
      },
    },
  },
};
