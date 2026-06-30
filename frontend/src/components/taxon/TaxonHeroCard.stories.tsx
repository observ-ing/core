import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonHeroCard } from "./TaxonHeroCard";
import { OAK_TAXON_DETAIL } from "../../../.storybook/fixtures";

const meta = {
  title: "Taxon/TaxonHeroCard",
  component: TaxonHeroCard,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonHeroCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHeroImage: Story = {
  args: {
    taxon: OAK_TAXON_DETAIL,
    heroUrl: OAK_TAXON_DETAIL.photoUrl,
  },
};

export const NoHeroImage: Story = {
  args: {
    taxon: OAK_TAXON_DETAIL,
  },
};
