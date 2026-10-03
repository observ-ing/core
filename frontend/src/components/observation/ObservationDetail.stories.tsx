import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { Routes, Route } from "react-router-dom";
import { ObservationDetail } from "./ObservationDetail";
import { OAK_OBSERVATION, OAK_IDENTIFICATION, SAMPLE_COMMENT } from "../../../.storybook/fixtures";

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

/**
 * The observer's own notes (Darwin Core occurrence and event remarks), shown
 * in Details. Line breaks in the text are kept.
 */
export const WithRemarks: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/occurrences/*", () =>
          HttpResponse.json({
            occurrence: {
              ...OAK_OBSERVATION,
              occurrenceRemarks:
                "Mature tree, roughly 20 m tall.\nAcorns present; lobed leaves with bristle tips.",
              eventRemarks:
                "Overcast after morning rain, on the north-facing slope above the creek.",
            },
            identifications: [OAK_IDENTIFICATION],
            comments: [],
          }),
        ),
      ],
    },
  },
};

/**
 * An observation cross-linked to the same sighting held elsewhere — an
 * iNaturalist observation and a record in another AT Protocol lexicon.
 */
export const WithExternalRecords: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/occurrences/*", () =>
          HttpResponse.json({
            occurrence: {
              ...OAK_OBSERVATION,
              externalRecords: [
                {
                  uri: "https://www.inaturalist.org/observations/123456789",
                  service: "inaturalist",
                },
                { uri: "https://bugguide.net/node/view/2261861", service: "bugguide" },
                {
                  uri: "at://did:plc:gainforest/app.gainforest.dwc.occurrence/3mu252kzh4y2h",
                },
              ],
            },
            identifications: [OAK_IDENTIFICATION],
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
