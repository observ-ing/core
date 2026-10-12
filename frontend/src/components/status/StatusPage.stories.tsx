import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { StatusPage } from "./StatusPage";
import type { ServiceStatus, ServiceStatusResponse } from "../../services/api";

const meta = {
  title: "Status/StatusPage",
  component: StatusPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof StatusPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const services: ServiceStatus[] = [
  {
    id: "observing-appview",
    name: "Website & API",
    description: "Serves this site and the API behind it.",
    state: "awake",
    instances: 2,
    activeInstances: 1,
  },
  {
    id: "tap-ingester",
    name: "Ingester",
    description:
      "Reads new observations, identifications and comments from the AT Protocol network into the index.",
    state: "up",
    instances: 1,
    activeInstances: 1,
  },
  {
    id: "observing-species-id",
    name: "Species ID",
    description: "Suggests species for photos you upload.",
    state: "awake",
    instances: 1,
    activeInstances: 0,
  },
  {
    id: "observing-species-id-live",
    name: "Live camera ID",
    description: "Suggests species from the live camera view, using a smaller, faster model.",
    state: "asleep",
    instances: 0,
    activeInstances: 0,
  },
  {
    id: "storybook",
    name: "Storybook",
    description: "The interactive component library.",
    state: "asleep",
    instances: 0,
    activeInstances: 0,
  },
  {
    id: "observing-db",
    name: "Database",
    description: "Stores the index of observations, identifications and profiles.",
    state: "up",
  },
];

function statusHandler(overrides: Partial<Record<string, Partial<ServiceStatus>>> = {}) {
  return http.get("/api/status", () =>
    HttpResponse.json<ServiceStatusResponse>({
      services: services.map((s) => ({ ...s, ...overrides[s.id] })),
      checkedAt: new Date(Date.now() - 20_000).toISOString(),
    }),
  );
}

export const Default: Story = {
  parameters: {
    msw: { handlers: [statusHandler()] },
  },
};

export const IngesterDown: Story = {
  parameters: {
    msw: {
      handlers: [
        statusHandler({ "tap-ingester": { state: "down", instances: 0, activeInstances: 0 } }),
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/status", async () => {
          await delay("infinite");
          return HttpResponse.json({});
        }),
      ],
    },
  },
};

export const Error: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/status", () =>
          HttpResponse.json({ error: "Couldn't read service status" }, { status: 502 }),
        ),
      ],
    },
  },
};
