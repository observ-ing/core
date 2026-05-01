import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { AdminPage } from "./AdminPage";

const meta = {
  title: "Admin/AdminPage",
  component: AdminPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof AdminPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const COLLECTIONS = [
  {
    nsid: "app.observ.occurrence",
    table: "occurrences",
    count: 1532,
    cascades_to: ["identifications", "comments", "likes"],
  },
  {
    nsid: "app.observ.identification",
    table: "identifications",
    count: 4218,
    cascades_to: [],
  },
  { nsid: "app.observ.comment", table: "comments", count: 612, cascades_to: [] },
  { nsid: "app.observ.like", table: "likes", count: 9001, cascades_to: [] },
];

const TABLES = [
  { name: "taxa", columns: ["id", "scientific_name", "kingdom"], count: 2_300_000 },
  { name: "wikidata_thumbs", columns: ["taxon_name", "url"], count: 850_000 },
  { name: "auth_sessions", columns: ["did", "expires_at"], count: 142 },
];

export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/collections", () =>
          HttpResponse.json({ collections: COLLECTIONS, total: 15_363 }),
        ),
        http.get("/admin/tables", () => HttpResponse.json({ tables: TABLES })),
      ],
    },
  },
};

export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/collections", () =>
          HttpResponse.json({ error: "Admin access required" }, { status: 403 }),
        ),
        http.get("/admin/tables", () =>
          HttpResponse.json({ error: "Admin access required" }, { status: 403 }),
        ),
      ],
    },
  },
};

export const ServerError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/collections", () =>
          HttpResponse.json({ error: "Database connection failed" }, { status: 500 }),
        ),
        http.get("/admin/tables", () =>
          HttpResponse.json({ error: "Database connection failed" }, { status: 500 }),
        ),
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/collections", async () => {
          await delay("infinite");
          return HttpResponse.json({ collections: [], total: 0 });
        }),
        http.get("/admin/tables", async () => {
          await delay("infinite");
          return HttpResponse.json({ tables: [] });
        }),
      ],
    },
  },
};
