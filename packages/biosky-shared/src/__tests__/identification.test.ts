import { describe, it, expect } from "vitest";
import { isMain, validateMain } from "../generated/types/org/rwell/test/identification.js";

describe("org.rwell.test.identification", () => {
  // ============================================================================
  // Main record tests
  // ============================================================================
  describe("Main", () => {
    describe("isMain", () => {
      it("returns true for valid typed identification record", () => {
        const record = {
          $type: "org.rwell.test.identification",
          subject: {
            uri: "at://did:plc:test/org.rwell.test.occurrence/abc123",
            cid: "bafyrei123",
          },
          taxonName: "Quercus agrifolia",
          taxonRank: "species",
          isAgreement: true,
          confidence: "high",
          createdAt: "2026-01-01T00:00:00Z",
        };
        expect(isMain(record)).toBe(true);
      });

      it("returns false for record with wrong $type", () => {
        const record = {
          $type: "app.bsky.feed.post",
          taxonName: "Quercus agrifolia",
        };
        expect(isMain(record)).toBe(false);
      });

      it("returns false for non-object values", () => {
        expect(isMain("string")).toBe(false);
        expect(isMain(123)).toBe(false);
        expect(isMain(null)).toBe(false);
        expect(isMain(undefined)).toBe(false);
      });
    });

    describe("validateMain", () => {
      it("fails validation when $type doesn't match", () => {
        const record = {
          $type: "wrong.type",
          subject: {
            uri: "at://did:plc:test/org.rwell.test.occurrence/abc123",
            cid: "bafyrei123",
          },
          taxonName: "Quercus agrifolia",
          createdAt: "2026-01-01T00:00:00Z",
        };
        const result = validateMain(record);
        expect(result.success).toBe(false);
      });
    });
  });
});
