import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhotoLightbox } from "./PhotoLightbox";

const SAMPLE_IMAGE =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=1200";

const meta = {
  title: "Observation/PhotoLightbox",
  component: PhotoLightbox,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    src: SAMPLE_IMAGE,
    alt: "Quercus robur (English oak)",
    onClose: () => undefined,
  },
} satisfies Meta<typeof PhotoLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  args: { open: false },
};

export const Open: Story = {
  args: { open: true },
};
