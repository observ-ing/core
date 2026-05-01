import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Routes, Route } from "react-router-dom";
import { TableDetailPage } from "./TableDetailPage";

const TAXA_ROWS = [
  {
    id: "Plantae/Quercus robur",
    scientific_name: "Quercus robur",
    kingdom: "Plantae",
    rank: "species",
  },
  {
    id: "Plantae/Quercus alba",
    scientific_name: "Quercus alba",
    kingdom: "Plantae",
    rank: "species",
  },
  {
    id: "Animalia/Sciurus vulgaris",
    scientific_name: "Sciurus vulgaris",
    kingdom: "Animalia",
    rank: "species",
  },
];

const meta = {
  title: "Admin/TableDetailPage",
  component: TableDetailPage,
  parameters: {
    layout: "fullscreen",
    routerInitialEntries: ["/admin/tables/taxa"],
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Routes>
        <Route path="/admin/tables/:name" element={<Story />} />
      </Routes>
    ),
  ],
} satisfies Meta<typeof TableDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/tables/:name/rows", () =>
          HttpResponse.json({
            name: "taxa",
            columns: ["id", "scientific_name", "kingdom", "rank"],
            rows: TAXA_ROWS,
            limit: 50,
            offset: 0,
          }),
        ),
      ],
    },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/tables/:name/rows", () =>
          HttpResponse.json({
            name: "taxa",
            columns: ["id", "scientific_name", "kingdom", "rank"],
            rows: [],
            limit: 50,
            offset: 0,
          }),
        ),
      ],
    },
  },
};

export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/tables/:name/rows", () =>
          HttpResponse.json({ error: "Admin access required" }, { status: 403 }),
        ),
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/tables/:name/rows", async () => {
          await delay("infinite");
          return HttpResponse.json({
            name: "taxa",
            columns: [],
            rows: [],
            limit: 50,
            offset: 0,
          });
        }),
      ],
    },
  },
};
