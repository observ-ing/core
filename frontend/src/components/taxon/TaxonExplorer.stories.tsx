import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Routes, Route } from "react-router-dom";
import { TaxonExplorer } from "./TaxonExplorer";
import {
  OAK_TAXON_DETAIL,
  OAK_OBSERVATION,
  FERN_OBSERVATION,
} from "../../../../.storybook/fixtures";

const meta = {
  title: "Taxon/TaxonExplorer",
  component: TaxonExplorer,
  parameters: {
    layout: "fullscreen",
    routerInitialEntries: ["/taxon/Plantae/Quercus-robur"],
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Routes>
        <Route path="/taxon/:kingdom/:name" element={<Story />} />
      </Routes>
    ),
  ],
} satisfies Meta<typeof TaxonExplorer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/taxa/:kingdom/:name", () => HttpResponse.json(OAK_TAXON_DETAIL)),
        http.get("/api/taxa/:kingdom/:name/occurrences", () =>
          HttpResponse.json({
            occurrences: [OAK_OBSERVATION, FERN_OBSERVATION],
            cursor: null,
          }),
        ),
        http.get("/api/taxa/:kingdom/:name/children", () => HttpResponse.json([])),
      ],
    },
  },
};

export const NotFound: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/taxa/:kingdom/:name", () => HttpResponse.json(null, { status: 404 })),
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/taxa/:kingdom/:name", async () => {
          await delay("infinite");
          return HttpResponse.json(OAK_TAXON_DETAIL);
        }),
      ],
    },
  },
};
