import type { Meta, StoryObj } from "@storybook/react-vite";
import { UploadModal } from "./UploadModal";
import { ALICE_USER, FERN_OBSERVATION, OAK_OBSERVATION } from "../../../.storybook/fixtures";

const meta = {
  title: "Modals/UploadModal",
  component: UploadModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof UploadModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseUiState = {
  loginModalOpen: false,
  uploadModalOpen: false,
  editingObservation: null,
  deleteConfirmObservation: null,
  toasts: [],
  currentLocation: null,
  themeMode: "dark" as const,
  effectiveTheme: "dark" as const,
};

const signedInState = {
  auth: { user: ALICE_USER, isLoading: false },
};

export const Closed: Story = {
  parameters: {
    storeOptions: { preloadedState: signedInState },
  },
};

export const NewObservation: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        ...signedInState,
        ui: { ...baseUiState, uploadModalOpen: true },
      },
    },
  },
};

export const EditExisting: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        ...signedInState,
        ui: {
          ...baseUiState,
          uploadModalOpen: true,
          editingObservation: OAK_OBSERVATION,
        },
      },
    },
  },
};

/**
 * Editing an observation that already cross-links to other platforms: the
 * "Also recorded on" field starts populated, because the save replaces the
 * record's whole list and would otherwise drop the entries.
 */
export const EditWithExternalRecords: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        ...signedInState,
        ui: {
          ...baseUiState,
          uploadModalOpen: true,
          editingObservation: FERN_OBSERVATION,
        },
      },
    },
  },
};

export const WithGeolocation: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        ...signedInState,
        ui: {
          ...baseUiState,
          uploadModalOpen: true,
          currentLocation: { lat: 51.5074, lng: -0.1278 },
        },
      },
    },
  },
};
