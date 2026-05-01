import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Routes, Route } from "react-router-dom";
import { CollectionDetailPage } from "./CollectionDetailPage";

const COLLECTION_DETAIL = {
  nsid: "app.observ.occurrence",
  table: "occurrences",
  count: 1532,
  cascades_to: ["identifications", "comments", "likes"],
  unique_dids: 87,
  oldest_indexed_at: "2026-01-04T08:00:00Z",
  newest_indexed_at: "2026-04-30T22:14:00Z",
};

const RECORDS = Array.from({ length: 12 }, (_, i) => ({
  uri: `at://did:plc:alice/app.observ.occurrence/oak${i + 1}`,
  cid: `bafyreiomock${i + 1}`,
  did: i % 3 === 0 ? "did:plc:bob" : "did:plc:alice",
  rkey: `oak${i + 1}`,
  indexed_at: `2026-04-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
}));

const meta = {
  title: "Admin/CollectionDetailPage",
  component: CollectionDetailPage,
  parameters: {
    layout: "fullscreen",
    routerInitialEntries: ["/admin/collections/app.observ.occurrence"],
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Routes>
        <Route path="/admin/collections/:nsid" element={<Story />} />
      </Routes>
    ),
  ],
} satisfies Meta<typeof CollectionDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/collections/:nsid", () => HttpResponse.json(COLLECTION_DETAIL)),
        http.get("/admin/collections/:nsid/records", () =>
          HttpResponse.json({ records: RECORDS, limit: 50, offset: 0 }),
        ),
      ],
    },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/collections/:nsid", () =>
          HttpResponse.json({
            ...COLLECTION_DETAIL,
            count: 0,
            unique_dids: 0,
            oldest_indexed_at: null,
            newest_indexed_at: null,
          }),
        ),
        http.get("/admin/collections/:nsid/records", () =>
          HttpResponse.json({ records: [], limit: 50, offset: 0 }),
        ),
      ],
    },
  },
};

export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/admin/collections/:nsid", () =>
          HttpResponse.json({ error: "Admin access required" }, { status: 403 }),
        ),
        http.get("/admin/collections/:nsid/records", () =>
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
        http.get("/admin/collections/:nsid", async () => {
          await delay("infinite");
          return HttpResponse.json(COLLECTION_DETAIL);
        }),
        http.get("/admin/collections/:nsid/records", async () => {
          await delay("infinite");
          return HttpResponse.json({ records: [], limit: 50, offset: 0 });
        }),
      ],
    },
  },
};
