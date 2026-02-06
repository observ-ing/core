import { describe, it, expect, vi, beforeEach } from "vitest";
import { Database } from "./index.js";

// Mock pg module - Pool must be a class constructor
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock("pg", () => {
  return {
    default: {
      Pool: class MockPool {
        query = mockQuery;
        on() {}
      },
    },
  };
});

describe("Database", () => {
  let db: Database;

  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue({ rows: [] });
    db = new Database("postgres://test");
  });

  describe("community ID refresh after identification changes", () => {
    const identificationEvent = {
      uri: "at://did:plc:test/org.rwell.test.identification/1",
      cid: "cid123",
      did: "did:plc:test",
      action: "create" as const,
      time: new Date(),
      record: {
        $type: "org.rwell.test.identification",
        subject: {
          uri: "at://did:plc:test/org.rwell.test.occurrence/1",
          cid: "subcid",
        },
        taxonName: "Quercus alba",
        createdAt: new Date().toISOString(),
      },
    };

    it("refreshes community_ids materialized view after upserting identification", async () => {
      await db.upsertIdentification(identificationEvent);

      const calls = mockQuery.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe(
        "REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids"
      );
    });

    it("refreshes community_ids materialized view after deleting identification", async () => {
      await db.deleteIdentification("at://did:plc:test/org.rwell.test.identification/1");

      const calls = mockQuery.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe(
        "REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids"
      );
    });

    it("does not refresh community_ids when identification has no record", async () => {
      await db.upsertIdentification({
        ...identificationEvent,
        record: undefined as any,
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
