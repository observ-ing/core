import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiTaxonThumbnail } from "./WikiTaxonThumbnail";

const meta = {
  title: "Common/WikiTaxonThumbnail",
  component: WikiTaxonThumbnail,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    src: { control: { type: "text" } },
    size: { control: { type: "number" } },
  },
} satisfies Meta<typeof WikiTaxonThumbnail>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_THUMB =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=100";

export const Default: Story = {
  args: {
    src: SAMPLE_THUMB,
    size: 24,
  },
};

export const Large: Story = {
  args: {
    src: SAMPLE_THUMB,
    size: 64,
  },
};

export const NoSource: Story = {
  args: {
    size: 24,
  },
  parameters: {
    docs: {
      description: {
        story:
          "When no `src` is provided, the component renders a placeholder box of the requested size — useful as a layout-stable slot while a thumbnail batch fetch is in flight.",
      },
    },
  },
};
