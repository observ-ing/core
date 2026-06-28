import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Breadcrumbs } from "./Breadcrumbs";

const meta = {
  title: "Common/Breadcrumbs",
  component: Breadcrumbs,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    items: [
      { label: "Animalia", href: "/taxon/Animalia" },
      { label: "Arthropoda", href: "/taxon/Animalia/Arthropoda" },
      { label: "Insecta", href: "/taxon/Animalia/Insecta" },
      { label: "Vanessa", href: "/taxon/Animalia/Vanessa", italic: true },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPlainCrumb: Story = {
  args: {
    items: [{ label: "Animalia" }, { label: "Chordata", href: "/taxon/Animalia/Chordata" }],
  },
};
