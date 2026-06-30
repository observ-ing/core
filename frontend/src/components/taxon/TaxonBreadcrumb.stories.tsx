import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonBreadcrumb } from "./TaxonBreadcrumb";
import { OAK_TAXON_DETAIL } from "../../../.storybook/fixtures";

const meta = {
  title: "Taxon/TaxonBreadcrumb",
  component: TaxonBreadcrumb,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TaxonBreadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    ancestors: OAK_TAXON_DETAIL.ancestors,
    kingdom: OAK_TAXON_DETAIL.kingdom,
  },
};

export const Empty: Story = {
  args: {
    ancestors: [],
  },
};
