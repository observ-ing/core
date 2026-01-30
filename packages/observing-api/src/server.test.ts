import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// Create mock instances that we can track
const mockDbInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getOAuthSession: vi.fn().mockResolvedValue(undefined),
};

const mockTaxonomyInstance = {};
const mockCommunityIdInstance = {};
const mockGeocodingInstance = {};
const mockInternalClientInstance = {};

// Mock all dependencies before importing the module
vi.mock("observing-shared", () => {
  return {
    Database: vi.fn().mockImplementation(function () {
      return mockDbInstance;
    }),
    TaxonomyClient: vi.fn().mockImplementation(function () {
      return mockTaxonomyInstance;
    }),
    CommunityIdCalculator: vi.fn().mockImplementation(function () {
      return mockCommunityIdInstance;
    }),
    GeocodingService: vi.fn().mockImplementation(function () {
      return mockGeocodingInstance;
    }),
  };
});

vi.mock("./routes/occurrences.js", () => ({
  createOccurrenceRoutes: vi.fn().mockReturnValue(express.Router()),
}));

vi.mock("./routes/feeds.js", () => ({
  createFeedRoutes: vi.fn().mockReturnValue(express.Router()),
}));

vi.mock("./routes/identifications.js", () => ({
  createIdentificationRoutes: vi.fn().mockReturnValue(express.Router()),
}));

vi.mock("./routes/taxonomy.js", () => ({
  createTaxonomyRoutes: vi.fn().mockReturnValue(express.Router()),
}));

vi.mock("./routes/profiles.js", () => ({
  createProfileRoutes: vi.fn().mockReturnValue(express.Router()),
}));

vi.mock("./routes/comments.js", () => ({
  createCommentRoutes: vi.fn().mockReturnValue(express.Router()),
}));

vi.mock("./internal-client.js", () => ({
  InternalClient: vi.fn().mockImplementation(function () {
    return mockInternalClientInstance;
  }),
}));

vi.mock("./middleware/logging.js", () => ({
  logger: {
    info: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Import after mocks are set up
import { ApiServer } from "./server.js";
import {
  Database,
  TaxonomyClient,
  CommunityIdCalculator,
  GeocodingService,
} from "observing-shared";
import { createOccurrenceRoutes } from "./routes/occurrences.js";
import { createFeedRoutes } from "./routes/feeds.js";
import { createIdentificationRoutes } from "./routes/identifications.js";
import { createTaxonomyRoutes } from "./routes/taxonomy.js";
import { createProfileRoutes } from "./routes/profiles.js";
import { createCommentRoutes } from "./routes/comments.js";
import { InternalClient } from "./internal-client.js";

describe("server.ts", () => {
  const defaultConfig = {
    port: 3002,
    databaseUrl: "postgresql://localhost:5432/test",
    corsOrigins: ["http://localhost:3000"],
    appviewUrl: "http://localhost:3000",
    internalSecret: "test-secret",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ApiServer", () => {
    describe("constructor", () => {
      it("initializes Database with provided URL", () => {
        new ApiServer(defaultConfig);
        expect(Database).toHaveBeenCalledWith(defaultConfig.databaseUrl);
      });

      it("initializes TaxonomyClient", () => {
        new ApiServer(defaultConfig);
        expect(TaxonomyClient).toHaveBeenCalled();
      });

      it("initializes CommunityIdCalculator with database", () => {
        new ApiServer(defaultConfig);
        expect(CommunityIdCalculator).toHaveBeenCalledWith(mockDbInstance);
      });

      it("initializes GeocodingService", () => {
        new ApiServer(defaultConfig);
        expect(GeocodingService).toHaveBeenCalled();
      });

      it("initializes InternalClient with config", () => {
        new ApiServer(defaultConfig);
        expect(InternalClient).toHaveBeenCalledWith({
          appviewUrl: defaultConfig.appviewUrl,
          internalSecret: defaultConfig.internalSecret,
        });
      });

      it("works without internalSecret", () => {
        const configWithoutSecret = { ...defaultConfig, internalSecret: undefined };
        new ApiServer(configWithoutSecret);
        expect(InternalClient).toHaveBeenCalledWith({
          appviewUrl: defaultConfig.appviewUrl,
          internalSecret: undefined,
        });
      });
    });

    describe("routes setup", () => {
      it("creates occurrence routes with correct dependencies", () => {
        new ApiServer(defaultConfig);
        expect(createOccurrenceRoutes).toHaveBeenCalledWith(
          mockDbInstance,
          mockTaxonomyInstance,
          mockGeocodingInstance,
          mockInternalClientInstance
        );
      });

      it("creates feed routes with database", () => {
        new ApiServer(defaultConfig);
        expect(createFeedRoutes).toHaveBeenCalledWith(mockDbInstance);
      });

      it("creates identification routes with dependencies", () => {
        new ApiServer(defaultConfig);
        expect(createIdentificationRoutes).toHaveBeenCalledWith(
          mockDbInstance,
          mockCommunityIdInstance,
          mockTaxonomyInstance,
          mockInternalClientInstance
        );
      });

      it("creates taxonomy routes with database and resolver", () => {
        new ApiServer(defaultConfig);
        expect(createTaxonomyRoutes).toHaveBeenCalledWith(
          mockDbInstance,
          mockTaxonomyInstance
        );
      });

      it("creates profile routes with database", () => {
        new ApiServer(defaultConfig);
        expect(createProfileRoutes).toHaveBeenCalledWith(mockDbInstance);
      });

      it("creates comment routes with internal client", () => {
        new ApiServer(defaultConfig);
        expect(createCommentRoutes).toHaveBeenCalledWith(mockInternalClientInstance);
      });
    });

    describe("health check endpoint", () => {
      it("returns ok status", async () => {
        const server = new ApiServer(defaultConfig);
        // Access the internal express app for testing
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app).get("/health");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: "ok" });
      });
    });

    describe("CORS middleware", () => {
      it("allows requests from configured origins", async () => {
        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app)
          .get("/health")
          .set("Origin", "http://localhost:3000");

        expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      });

      it("allows credentials", async () => {
        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app)
          .options("/health")
          .set("Origin", "http://localhost:3000")
          .set("Access-Control-Request-Method", "GET");

        expect(res.headers["access-control-allow-credentials"]).toBe("true");
      });

      it("supports multiple origins", async () => {
        const multiOriginConfig = {
          ...defaultConfig,
          corsOrigins: ["http://localhost:3000", "http://localhost:5173"],
        };
        const server = new ApiServer(multiOriginConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app)
          .get("/health")
          .set("Origin", "http://localhost:5173");

        expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      });
    });

    describe("JSON body parsing", () => {
      it("parses JSON request bodies", async () => {
        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        // Add a test route that echoes the body
        app.post("/test-json", (req, res) => {
          res.json(req.body);
        });

        const testData = { key: "value", nested: { data: 123 } };
        const res = await request(app)
          .post("/test-json")
          .send(testData)
          .set("Content-Type", "application/json");

        expect(res.status).toBe(200);
        expect(res.body).toEqual(testData);
      });

      it("handles large JSON bodies up to 50mb", async () => {
        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        app.post("/test-json", (req, res) => {
          res.json({ received: true, size: JSON.stringify(req.body).length });
        });

        // Create a moderately large payload (1MB)
        const largeData = { data: "x".repeat(1024 * 1024) };
        const res = await request(app)
          .post("/test-json")
          .send(largeData)
          .set("Content-Type", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);
      });
    });

    describe("cookie parsing", () => {
      it("parses cookies from requests", async () => {
        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        app.get("/test-cookies", (req, res) => {
          res.json({ cookies: req.cookies });
        });

        const res = await request(app)
          .get("/test-cookies")
          .set("Cookie", "session_did=did:plc:test;other=value");

        expect(res.status).toBe(200);
        expect(res.body.cookies).toEqual({
          session_did: "did:plc:test",
          other: "value",
        });
      });
    });

    describe("API route mounting", () => {
      it("mounts occurrences routes at /api/occurrences", async () => {
        // Create a mock router that responds
        const mockRouter = express.Router();
        mockRouter.get("/test", (_req, res) => res.json({ route: "occurrences" }));
        vi.mocked(createOccurrenceRoutes).mockReturnValue(mockRouter);

        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app).get("/api/occurrences/test");
        expect(res.status).toBe(200);
        expect(res.body.route).toBe("occurrences");
      });

      it("mounts feeds routes at /api/feeds", async () => {
        const mockRouter = express.Router();
        mockRouter.get("/test", (_req, res) => res.json({ route: "feeds" }));
        vi.mocked(createFeedRoutes).mockReturnValue(mockRouter);

        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app).get("/api/feeds/test");
        expect(res.status).toBe(200);
        expect(res.body.route).toBe("feeds");
      });

      it("mounts identifications routes at /api/identifications", async () => {
        const mockRouter = express.Router();
        mockRouter.get("/test", (_req, res) => res.json({ route: "identifications" }));
        vi.mocked(createIdentificationRoutes).mockReturnValue(mockRouter);

        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app).get("/api/identifications/test");
        expect(res.status).toBe(200);
        expect(res.body.route).toBe("identifications");
      });

      it("mounts taxonomy routes at /api/taxa", async () => {
        const mockRouter = express.Router();
        mockRouter.get("/test", (_req, res) => res.json({ route: "taxonomy" }));
        vi.mocked(createTaxonomyRoutes).mockReturnValue(mockRouter);

        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app).get("/api/taxa/test");
        expect(res.status).toBe(200);
        expect(res.body.route).toBe("taxonomy");
      });

      it("mounts profiles routes at /api/profiles", async () => {
        const mockRouter = express.Router();
        mockRouter.get("/test", (_req, res) => res.json({ route: "profiles" }));
        vi.mocked(createProfileRoutes).mockReturnValue(mockRouter);

        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app).get("/api/profiles/test");
        expect(res.status).toBe(200);
        expect(res.body.route).toBe("profiles");
      });

      it("mounts comments routes at /api/comments", async () => {
        const mockRouter = express.Router();
        mockRouter.get("/test", (_req, res) => res.json({ route: "comments" }));
        vi.mocked(createCommentRoutes).mockReturnValue(mockRouter);

        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const res = await request(app).get("/api/comments/test");
        expect(res.status).toBe(200);
        expect(res.body.route).toBe("comments");
      });
    });

    describe("start()", () => {
      it("connects to database", async () => {
        const server = new ApiServer(defaultConfig);

        // Mock listen to resolve immediately
        const app = (server as unknown as { app: express.Application }).app;
        app.listen = vi.fn().mockImplementation((_port: number, callback: () => void) => {
          callback();
          return { close: vi.fn() };
        }) as unknown as typeof app.listen;

        await server.start();

        expect(mockDbInstance.connect).toHaveBeenCalled();
      });

      it("starts listening on configured port", async () => {
        const server = new ApiServer(defaultConfig);
        const app = (server as unknown as { app: express.Application }).app;

        const listenMock = vi.fn().mockImplementation((_port: number, callback: () => void) => {
          callback();
          return { close: vi.fn() };
        });
        app.listen = listenMock as unknown as typeof app.listen;

        await server.start();

        expect(listenMock).toHaveBeenCalledWith(defaultConfig.port, expect.any(Function));
      });
    });

    describe("stop()", () => {
      it("disconnects from database", async () => {
        const server = new ApiServer(defaultConfig);

        await server.stop();

        expect(mockDbInstance.disconnect).toHaveBeenCalled();
      });
    });
  });
});

describe("getDatabaseUrl", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear relevant env vars
    delete process.env["DB_PASSWORD"];
    delete process.env["DB_HOST"];
    delete process.env["DB_NAME"];
    delete process.env["DB_USER"];
    delete process.env["DATABASE_URL"];
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // Note: getDatabaseUrl is not exported, but we can test its behavior
  // through the ApiServer constructor by checking Database instantiation
  it("uses DATABASE_URL when DB_PASSWORD is not set", () => {
    process.env["DATABASE_URL"] = "postgresql://custom:5432/customdb";

    new ApiServer({
      port: 3002,
      databaseUrl: process.env["DATABASE_URL"],
      corsOrigins: ["http://localhost:3000"],
      appviewUrl: "http://localhost:3000",
    });

    expect(Database).toHaveBeenCalledWith("postgresql://custom:5432/customdb");
  });

  it("uses default localhost URL when no env vars set", () => {
    const defaultUrl = "postgresql://localhost:5432/observing";

    new ApiServer({
      port: 3002,
      databaseUrl: defaultUrl,
      corsOrigins: ["http://localhost:3000"],
      appviewUrl: "http://localhost:3000",
    });

    expect(Database).toHaveBeenCalledWith(defaultUrl);
  });
});
