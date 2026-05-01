import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { FeedView } from "./FeedView";
import { OAK_OBSERVATION, FERN_OBSERVATION } from "../../../../.storybook/fixtures";

const meta = {
  title: "Feed/FeedView",
  component: FeedView,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof FeedView>;

export default meta;
type Story = StoryObj<typeof meta>;

const populatedHandlers = [
  http.get("/api/feeds/explore", () =>
    HttpResponse.json({
      occurrences: [OAK_OBSERVATION, FERN_OBSERVATION],
      cursor: null,
    }),
  ),
  http.get("/api/feeds/home", () =>
    HttpResponse.json({
      occurrences: [OAK_OBSERVATION, FERN_OBSERVATION],
      cursor: null,
    }),
  ),
];

export const HomeWithObservations: Story = {
  args: { tab: "home" },
  parameters: {
    msw: { handlers: populatedHandlers },
  },
};

export const ExploreWithObservations: Story = {
  args: { tab: "explore" },
  parameters: {
    msw: { handlers: populatedHandlers },
  },
};

export const HomeEmpty: Story = {
  args: { tab: "home" },
};

export const ExploreEmpty: Story = {
  args: { tab: "explore" },
};

export const Loading: Story = {
  args: { tab: "home" },
  parameters: {
    msw: {
      // FeedView triggers an explore fetch on first render before settling
      // on the active tab, so both endpoints need to hang to keep the
      // component visibly in its loading state.
      handlers: [
        http.get("/api/feeds/home", async () => {
          await delay("infinite");
          return HttpResponse.json({ occurrences: [], cursor: null });
        }),
        http.get("/api/feeds/explore", async () => {
          await delay("infinite");
          return HttpResponse.json({ occurrences: [], cursor: null });
        }),
      ],
    },
  },
};
