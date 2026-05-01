import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonDetailPanel } from "./TaxonDetailPanel";
import {
  OAK_TAXON_DETAIL,
  OAK_OBSERVATION,
  FERN_OBSERVATION,
} from "../../../../.storybook/fixtures";

const meta = {
  title: "Taxon/TaxonDetailPanel",
  component: TaxonDetailPanel,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    onBack: () => undefined,
    onLoadMore: () => undefined,
  },
} satisfies Meta<typeof TaxonDetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithObservations: Story = {
  args: {
    taxon: OAK_TAXON_DETAIL,
    heroUrl: OAK_TAXON_DETAIL.photoUrl,
    observations: [OAK_OBSERVATION, FERN_OBSERVATION],
    hasMore: true,
    loadingMore: false,
  },
};

export const NoObservations: Story = {
  args: {
    taxon: OAK_TAXON_DETAIL,
    heroUrl: OAK_TAXON_DETAIL.photoUrl,
    observations: [],
    hasMore: false,
    loadingMore: false,
  },
};

export const NoHeroImage: Story = {
  args: {
    taxon: OAK_TAXON_DETAIL,
    observations: [OAK_OBSERVATION],
    hasMore: false,
    loadingMore: false,
  },
};

export const LoadingMore: Story = {
  args: {
    taxon: OAK_TAXON_DETAIL,
    heroUrl: OAK_TAXON_DETAIL.photoUrl,
    observations: [OAK_OBSERVATION, FERN_OBSERVATION],
    hasMore: true,
    loadingMore: true,
  },
};

export const WithTreeToggle: Story = {
  args: {
    taxon: OAK_TAXON_DETAIL,
    heroUrl: OAK_TAXON_DETAIL.photoUrl,
    observations: [OAK_OBSERVATION],
    hasMore: false,
    loadingMore: false,
    onToggleTree: () => undefined,
  },
};
