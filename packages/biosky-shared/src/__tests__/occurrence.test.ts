import { describe, it, expect } from "vitest";
import {
  isMain,
  validateMain,
  isLocation,
  validateLocation,
  isImageEmbed,
  validateImageEmbed,
  isAspectRatio,
  validateAspectRatio,
} from "../generated/types/org/rwell/test/occurrence.js";

describe("org.rwell.test.occurrence", () => {
  // ============================================================================
  // Main record tests
  // ============================================================================
  describe("Main", () => {
    describe("isMain", () => {
      it("returns true for valid typed occurrence record", () => {
        const record = {
          $type: "org.rwell.test.occurrence",
          scientificName: "Quercus agrifolia",
          eventDate: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          location: {
            decimalLatitude: "37.7749",
            decimalLongitude: "-122.4194",
            geodeticDatum: "WGS84",
          },
        };
        expect(isMain(record)).toBe(true);
      });

      it("returns false for record with wrong $type", () => {
        const record = {
          $type: "app.bsky.feed.post",
          scientificName: "Quercus agrifolia",
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
      it("validates a complete valid record", () => {
        const record = {
          $type: "org.rwell.test.occurrence",
          scientificName: "Quercus agrifolia",
          eventDate: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          location: {
            decimalLatitude: "37.7749",
            decimalLongitude: "-122.4194",
            geodeticDatum: "WGS84",
          },
        };
        const result = validateMain(record);
        expect(result.success).toBe(true);
      });

      it("validates record with optional fields", () => {
        const record = {
          $type: "org.rwell.test.occurrence",
          scientificName: "Quercus agrifolia",
          eventDate: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          location: {
            decimalLatitude: "37.7749",
            decimalLongitude: "-122.4194",
            coordinateUncertaintyInMeters: 50,
            geodeticDatum: "WGS84",
          },
          verbatimLocality: "Golden Gate Park, San Francisco, CA",
          notes: "Observed near the main entrance",
          blobs: [],
        };
        const result = validateMain(record);
        expect(result.success).toBe(true);
      });

      it("fails validation when scientificName is missing", () => {
        const record = {
          $type: "org.rwell.test.occurrence",
          eventDate: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          location: {
            decimalLatitude: "37.7749",
            decimalLongitude: "-122.4194",
            geodeticDatum: "WGS84",
          },
        };
        const result = validateMain(record);
        expect(result.success).toBe(false);
      });

      it("fails validation when location is missing", () => {
        const record = {
          $type: "org.rwell.test.occurrence",
          scientificName: "Quercus agrifolia",
          eventDate: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
        };
        const result = validateMain(record);
        expect(result.success).toBe(false);
      });

      it("fails validation with wrong $type", () => {
        const record = {
          $type: "wrong.type",
          scientificName: "Quercus agrifolia",
          eventDate: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          location: {
            decimalLatitude: "37.7749",
            decimalLongitude: "-122.4194",
            geodeticDatum: "WGS84",
          },
        };
        const result = validateMain(record);
        expect(result.success).toBe(false);
      });
    });
  });

  // ============================================================================
  // Location tests
  // ============================================================================
  describe("Location", () => {
    describe("isLocation", () => {
      it("returns true for typed location object", () => {
        const location = {
          $type: "org.rwell.test.occurrence#location",
          decimalLatitude: "37.7749",
          decimalLongitude: "-122.4194",
          geodeticDatum: "WGS84",
        };
        expect(isLocation(location)).toBe(true);
      });

      it("returns false for untyped location object", () => {
        const location = {
          decimalLatitude: "37.7749",
          decimalLongitude: "-122.4194",
          geodeticDatum: "WGS84",
        };
        // Without $type, isLocation returns false
        expect(isLocation(location)).toBe(false);
      });
    });

    describe("validateLocation", () => {
      it("validates a complete location", () => {
        const location = {
          decimalLatitude: "37.7749",
          decimalLongitude: "-122.4194",
          geodeticDatum: "WGS84",
        };
        const result = validateLocation(location);
        expect(result.success).toBe(true);
      });

      it("validates location with optional coordinateUncertaintyInMeters", () => {
        const location = {
          decimalLatitude: "37.7749",
          decimalLongitude: "-122.4194",
          coordinateUncertaintyInMeters: 100,
          geodeticDatum: "WGS84",
        };
        const result = validateLocation(location);
        expect(result.success).toBe(true);
      });

      it("fails when decimalLatitude is missing", () => {
        const location = {
          decimalLongitude: "-122.4194",
          geodeticDatum: "WGS84",
        };
        const result = validateLocation(location);
        expect(result.success).toBe(false);
      });

      it("validates location without geodeticDatum (optional field with default)", () => {
        const location = {
          decimalLatitude: "37.7749",
          decimalLongitude: "-122.4194",
        };
        const result = validateLocation(location);
        // geodeticDatum has a default value of WGS84 so it's optional
        expect(result.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // ImageEmbed tests
  // ============================================================================
  describe("ImageEmbed", () => {
    // Create a valid blob ref structure for AT Protocol
    const validBlobRef = {
      $type: "blob",
      ref: { $link: "bafyrei123" },
      mimeType: "image/jpeg",
      size: 1024,
    };

    describe("isImageEmbed", () => {
      it("returns true for typed image embed", () => {
        const embed = {
          $type: "org.rwell.test.occurrence#imageEmbed",
          image: validBlobRef,
          alt: "A photo of a tree",
        };
        expect(isImageEmbed(embed)).toBe(true);
      });

      it("returns false for untyped object", () => {
        const embed = {
          image: validBlobRef,
          alt: "A photo of a tree",
        };
        expect(isImageEmbed(embed)).toBe(false);
      });
    });

    describe("validateImageEmbed", () => {
      it("fails when alt is missing", () => {
        const embed = {
          image: validBlobRef,
        };
        const result = validateImageEmbed(embed);
        expect(result.success).toBe(false);
      });

      it("fails when image is missing", () => {
        const embed = {
          alt: "A photo of a tree",
        };
        const result = validateImageEmbed(embed);
        expect(result.success).toBe(false);
      });
    });
  });

  // ============================================================================
  // AspectRatio tests
  // ============================================================================
  describe("AspectRatio", () => {
    describe("isAspectRatio", () => {
      it("returns true for typed aspect ratio", () => {
        const ratio = {
          $type: "org.rwell.test.occurrence#aspectRatio",
          width: 1920,
          height: 1080,
        };
        expect(isAspectRatio(ratio)).toBe(true);
      });

      it("returns false for untyped object", () => {
        const ratio = {
          width: 1920,
          height: 1080,
        };
        expect(isAspectRatio(ratio)).toBe(false);
      });
    });

    describe("validateAspectRatio", () => {
      it("validates complete aspect ratio", () => {
        const ratio = {
          width: 1920,
          height: 1080,
        };
        const result = validateAspectRatio(ratio);
        expect(result.success).toBe(true);
      });

      it("fails when width is missing", () => {
        const ratio = {
          height: 1080,
        };
        const result = validateAspectRatio(ratio);
        expect(result.success).toBe(false);
      });

      it("fails when height is missing", () => {
        const ratio = {
          width: 1920,
        };
        const result = validateAspectRatio(ratio);
        expect(result.success).toBe(false);
      });
    });
  });
});
