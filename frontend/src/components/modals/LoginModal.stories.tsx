import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoginModal } from "./LoginModal";

const meta = {
  title: "Modals/LoginModal",
  component: LoginModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LoginModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseUiState = {
  uploadModalOpen: false,
  editingObservation: null,
  deleteConfirmObservation: null,
  toasts: [],
  currentLocation: null,
  themeMode: "dark" as const,
  effectiveTheme: "dark" as const,
};

export const Closed: Story = {};

export const Open: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        ui: { ...baseUiState, loginModalOpen: true },
      },
    },
  },
};
