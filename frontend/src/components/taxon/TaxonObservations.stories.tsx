import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonObservations } from "./TaxonObservations";
import { OAK_OBSERVATION, FERN_OBSERVATION } from "../../../.storybook/fixtures";

const meta = {
  title: "Taxon/TaxonObservations",
  component: TaxonObservations,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    emptyName: "Painted Lady",
    onLoadMore: () => undefined,
  },
} satisfies Meta<typeof TaxonObservations>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithObservations: Story = {
  args: {
    observations: [OAK_OBSERVATION, FERN_OBSERVATION],
    hasMore: true,
    loadingMore: false,
  },
};

export const Empty: Story = {
  args: {
    observations: [],
    hasMore: false,
    loadingMore: false,
  },
};
