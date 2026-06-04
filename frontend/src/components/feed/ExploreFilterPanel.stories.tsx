import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExploreFilterPanel } from "./ExploreFilterPanel";

const meta = {
  title: "Feed/ExploreFilterPanel",
  component: ExploreFilterPanel,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ExploreFilterPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const WithActiveFilters: Story = {
  parameters: {
    storeOptions: {
      preloadedState: {
        feed: {
          filters: {
            taxon: "Quercus robur",
            kingdom: "Plantae",
            startDate: "2026-01-01",
            endDate: "2026-04-30",
          },
        },
      },
    },
  },
};
