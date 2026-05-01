import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { OAK_OBSERVATION } from "../../../../.storybook/fixtures";

const meta = {
  title: "Modals/DeleteConfirmDialog",
  component: DeleteConfirmDialog,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DeleteConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseUiState = {
  loginModalOpen: false,
  uploadModalOpen: false,
  editingObservation: null,
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
        ui: { ...baseUiState, deleteConfirmObservation: OAK_OBSERVATION },
      },
    },
  },
};

const { effectiveTaxonomy: _drop, ...unidentifiedObservation } = OAK_OBSERVATION;
void _drop;

export const UnidentifiedObservation: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        ui: {
          ...baseUiState,
          deleteConfirmObservation: unidentifiedObservation,
        },
      },
    },
  },
};
