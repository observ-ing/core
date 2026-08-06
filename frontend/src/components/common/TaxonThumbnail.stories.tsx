import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaxonThumbnail } from "./TaxonThumbnail";

const meta = {
  title: "Common/TaxonThumbnail",
  component: TaxonThumbnail,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    src: { control: { type: "text" } },
    size: { control: { type: "number" } },
    borderRadius: { control: { type: "text" } },
    emptyBgcolor: { control: { type: "text" } },
  },
} satisfies Meta<typeof TaxonThumbnail>;

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

export const NoSourceEmpty: Story = {
  args: {
    size: 24,
  },
  parameters: {
    docs: {
      description: {
        story: "When there is no `src` and no `emptyBgcolor`, the component renders nothing.",
      },
    },
  },
};

export const NoSourcePlaceholder: Story = {
  args: {
    size: 40,
    emptyBgcolor: "action.disabledBackground",
  },
  parameters: {
    docs: {
      description: {
        story:
          "With `emptyBgcolor` set, the component renders a layout-stable placeholder box in that color — useful while a thumbnail fetch is in flight or as a table-row fallback.",
      },
    },
  },
};
