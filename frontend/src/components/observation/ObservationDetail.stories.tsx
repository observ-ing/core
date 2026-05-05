import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Routes, Route } from "react-router-dom";
import { ObservationDetail } from "./ObservationDetail";
import {
  OAK_OBSERVATION,
  OAK_IDENTIFICATION,
  SAMPLE_COMMENT,
} from "../../../../.storybook/fixtures";

const meta = {
  title: "Observation/ObservationDetail",
  component: ObservationDetail,
  parameters: {
    layout: "fullscreen",
    routerInitialEntries: ["/observation/did:plc:alice/oak1"],
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Routes>
        <Route path="/observation/:did/:rkey" element={<Story />} />
      </Routes>
    ),
  ],
} satisfies Meta<typeof ObservationDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/occurrences/*", () =>
          HttpResponse.json({
            occurrence: OAK_OBSERVATION,
            identifications: [OAK_IDENTIFICATION],
            comments: [SAMPLE_COMMENT],
          }),
        ),
      ],
    },
  },
};

export const NoDiscussion: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/occurrences/*", () =>
          HttpResponse.json({
            occurrence: OAK_OBSERVATION,
            identifications: [],
            comments: [],
          }),
        ),
      ],
    },
  },
};

export const NotFound: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/occurrences/*", () => HttpResponse.json(null, { status: 404 }))],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/occurrences/*", async () => {
          await delay("infinite");
          return HttpResponse.json({
            occurrence: OAK_OBSERVATION,
            identifications: [],
            comments: [],
          });
        }),
      ],
    },
  },
};
