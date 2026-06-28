import type { Meta, StoryObj } from "@storybook/react-vite";
import { Breadcrumbs } from "./Breadcrumbs";

// The global preview decorator (.storybook/preview.tsx) already wraps every
// story in a MemoryRouter, so this story must NOT add its own — nested routers
// throw "You cannot render a <Router> inside another <Router>".
const meta = {
  title: "Common/Breadcrumbs",
  component: Breadcrumbs,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
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
