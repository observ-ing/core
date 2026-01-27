import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OccurrenceRow, IdentificationRow, CommentRow } from "biosky-shared";

// Mock identity resolver
const mockGetProfiles = vi.fn();
vi.mock("biosky-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("biosky-shared")>();
  return {
    ...actual,
    getIdentityResolver: () => ({
      getProfiles: mockGetProfiles,
    }),
  };
});

import { enrichOccurrences, enrichIdentifications, enrichComments } from "./enrichment.js";

describe("enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("enrichOccurrences", () => {
    const createMockDb = () => ({
      getOccurrenceObservers: vi.fn(),
      getSubjectsForOccurrence: vi.fn(),
      getCommunityId: vi.fn(),
      getIdentificationsForOccurrence: vi.fn(),
    });

    const createOccurrenceRow = (overrides = {}): OccurrenceRow => ({
      uri: "at://did:plc:test/org.rwell.test.occurrence/1",
      cid: "cid123",
      did: "did:plc:test",
      scientific_name: "Quercus alba",
      taxon_id: "12345",
      taxon_rank: "species",
      vernacular_name: "White Oak",
      kingdom: "Plantae",
      phylum: "Tracheophyta",
      class: "Magnoliopsida",
      order: "Fagales",
      family: "Fagaceae",
      genus: "Quercus",
      event_date: new Date("2024-01-15"),
      latitude: 40.7128,
      longitude: -74.006,
      coordinate_uncertainty_meters: 100,
      continent: "North America",
      country: "United States",
      country_code: "US",
      state_province: "New York",
      county: "New York County",
      municipality: "Manhattan",
      locality: "Central Park",
      water_body: null,
      verbatim_locality: "Near the lake",
      occurrence_remarks: "Beautiful tree",
      associated_media: [
        { image: { ref: "bafycid123" } },
      ],
      recorded_by: null,
      created_at: new Date("2024-01-15T12:00:00Z"),
      ...overrides,
    });

    it("returns empty array for empty input", async () => {
      const mockDb = createMockDb();
      const result = await enrichOccurrences(mockDb as any, []);
      expect(result).toEqual([]);
    });

    it("enriches occurrence with profile data", async () => {
      const mockDb = createMockDb();
      const profile = {
        did: "did:plc:test",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://avatar.url",
      };
      mockGetProfiles.mockResolvedValue(new Map([["did:plc:test", profile]]));
      mockDb.getOccurrenceObservers.mockResolvedValue([]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([]);
      mockDb.getCommunityId.mockResolvedValue(null);

      const rows = [createOccurrenceRow()];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result).toHaveLength(1);
      expect(result[0].observer).toEqual({
        did: "did:plc:test",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://avatar.url",
      });
    });

    it("includes observers from database", async () => {
      const mockDb = createMockDb();
      mockGetProfiles.mockResolvedValue(
        new Map([
          ["did:plc:owner", { did: "did:plc:owner", handle: "owner.bsky.social" }],
          ["did:plc:coobs", { did: "did:plc:coobs", handle: "coobs.bsky.social" }],
        ])
      );
      mockDb.getOccurrenceObservers.mockResolvedValue([
        { did: "did:plc:owner", role: "owner" },
        { did: "did:plc:coobs", role: "co-observer" },
      ]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([]);
      mockDb.getCommunityId.mockResolvedValue(null);

      const rows = [createOccurrenceRow({ did: "did:plc:owner" })];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result[0].observers).toHaveLength(2);
      expect(result[0].observers[0].role).toBe("owner");
      expect(result[0].observers[1].role).toBe("co-observer");
    });

    it("adds owner as observer when no observers in table", async () => {
      const mockDb = createMockDb();
      mockGetProfiles.mockResolvedValue(
        new Map([["did:plc:test", { did: "did:plc:test", handle: "test.bsky.social" }]])
      );
      mockDb.getOccurrenceObservers.mockResolvedValue([]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([]);
      mockDb.getCommunityId.mockResolvedValue(null);

      const rows = [createOccurrenceRow()];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result[0].observers).toHaveLength(1);
      expect(result[0].observers[0].did).toBe("did:plc:test");
      expect(result[0].observers[0].role).toBe("owner");
    });

    it("includes subjects with community IDs", async () => {
      const mockDb = createMockDb();
      mockGetProfiles.mockResolvedValue(new Map());
      mockDb.getOccurrenceObservers.mockResolvedValue([]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([
        { subjectIndex: 0, identificationCount: 3, latestIdentification: null },
        { subjectIndex: 1, identificationCount: 1, latestIdentification: null },
      ]);
      mockDb.getCommunityId.mockImplementation((_uri, index) =>
        index === 0 ? "Quercus alba" : null
      );
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        { subject_index: 0, scientific_name: "Quercus alba" },
      ]);

      const rows = [createOccurrenceRow()];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result[0].subjects).toHaveLength(2);
      expect(result[0].subjects[0].communityId).toBe("Quercus alba");
      expect(result[0].subjects[1].communityId).toBeUndefined();
    });

    it("always includes subject 0", async () => {
      const mockDb = createMockDb();
      mockGetProfiles.mockResolvedValue(new Map());
      mockDb.getOccurrenceObservers.mockResolvedValue([]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([
        { subjectIndex: 1, identificationCount: 1, latestIdentification: null },
      ]);
      mockDb.getCommunityId.mockResolvedValue(null);

      const rows = [createOccurrenceRow()];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result[0].subjects.some((s: { index: number }) => s.index === 0)).toBe(true);
    });

    it("builds effective taxonomy from winning identification", async () => {
      const mockDb = createMockDb();
      mockGetProfiles.mockResolvedValue(new Map());
      mockDb.getOccurrenceObservers.mockResolvedValue([]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([]);
      mockDb.getCommunityId.mockResolvedValue("Quercus alba");
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        {
          subject_index: 0,
          scientific_name: "Quercus alba",
          taxon_id: "12345",
          taxon_rank: "species",
          vernacular_name: "White Oak",
          kingdom: "Plantae",
          phylum: "Tracheophyta",
          class: "Magnoliopsida",
          order: "Fagales",
          family: "Fagaceae",
          genus: "Quercus",
        },
      ]);

      const rows = [createOccurrenceRow()];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result[0].effectiveTaxonomy).toEqual({
        scientificName: "Quercus alba",
        taxonId: "12345",
        taxonRank: "species",
        vernacularName: "White Oak",
        kingdom: "Plantae",
        phylum: "Tracheophyta",
        class: "Magnoliopsida",
        order: "Fagales",
        family: "Fagaceae",
        genus: "Quercus",
      });
    });

    it("maps image blobs to media URLs", async () => {
      const mockDb = createMockDb();
      mockGetProfiles.mockResolvedValue(new Map());
      mockDb.getOccurrenceObservers.mockResolvedValue([]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([]);
      mockDb.getCommunityId.mockResolvedValue(null);

      const rows = [
        createOccurrenceRow({
          associated_media: [
            { image: { ref: "cid1" } },
            { image: { ref: { $link: "cid2" } } },
          ],
        }),
      ];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result[0].images).toEqual([
        "/media/blob/did:plc:test/cid1",
        "/media/blob/did:plc:test/cid2",
      ]);
    });

    it("handles missing profile gracefully", async () => {
      const mockDb = createMockDb();
      mockGetProfiles.mockResolvedValue(new Map());
      mockDb.getOccurrenceObservers.mockResolvedValue([]);
      mockDb.getSubjectsForOccurrence.mockResolvedValue([]);
      mockDb.getCommunityId.mockResolvedValue(null);

      const rows = [createOccurrenceRow()];
      const result = await enrichOccurrences(mockDb as any, rows);

      expect(result[0].observer.did).toBe("did:plc:test");
      expect(result[0].observer.handle).toBeUndefined();
    });
  });

  describe("enrichIdentifications", () => {
    const createIdentificationRow = (overrides = {}): IdentificationRow => ({
      uri: "at://did:plc:test/org.rwell.test.identification/1",
      cid: "cid123",
      did: "did:plc:identifier",
      subject_uri: "at://did:plc:test/org.rwell.test.occurrence/1",
      subject_cid: "subcid",
      subject_index: 0,
      scientific_name: "Quercus alba",
      taxon_rank: "species",
      identification_qualifier: null,
      taxon_id: null,
      identification_remarks: null,
      identification_verification_status: null,
      type_status: null,
      is_agreement: false,
      date_identified: new Date(),
      vernacular_name: null,
      kingdom: null,
      phylum: null,
      class: null,
      order: null,
      family: null,
      genus: null,
      confidence: null,
      ...overrides,
    });

    it("returns empty array for empty input", async () => {
      const result = await enrichIdentifications([]);
      expect(result).toEqual([]);
    });

    it("enriches identifications with identifier profile", async () => {
      const profile = {
        did: "did:plc:identifier",
        handle: "expert.bsky.social",
        displayName: "Expert User",
        avatar: "https://avatar.url",
      };
      mockGetProfiles.mockResolvedValue(new Map([["did:plc:identifier", profile]]));

      const rows = [createIdentificationRow()];
      const result = await enrichIdentifications(rows);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toEqual({
        did: "did:plc:identifier",
        handle: "expert.bsky.social",
        displayName: "Expert User",
        avatar: "https://avatar.url",
      });
    });

    it("handles missing profile", async () => {
      mockGetProfiles.mockResolvedValue(new Map());

      const rows = [createIdentificationRow()];
      const result = await enrichIdentifications(rows);

      expect(result[0].identifier).toBeUndefined();
    });

    it("fetches profiles for unique DIDs only", async () => {
      mockGetProfiles.mockResolvedValue(new Map());

      const rows = [
        createIdentificationRow({ did: "did:plc:user1" }),
        createIdentificationRow({ did: "did:plc:user1" }),
        createIdentificationRow({ did: "did:plc:user2" }),
      ];
      await enrichIdentifications(rows);

      expect(mockGetProfiles).toHaveBeenCalledWith(["did:plc:user1", "did:plc:user2"]);
    });
  });

  describe("enrichComments", () => {
    const createCommentRow = (overrides = {}): CommentRow => ({
      uri: "at://did:plc:test/org.rwell.test.comment/1",
      cid: "cid123",
      did: "did:plc:commenter",
      subject_uri: "at://did:plc:test/org.rwell.test.occurrence/1",
      subject_cid: "subcid",
      body: "Great observation!",
      reply_to_uri: null,
      reply_to_cid: null,
      created_at: new Date(),
      ...overrides,
    });

    it("returns empty array for empty input", async () => {
      const result = await enrichComments([]);
      expect(result).toEqual([]);
    });

    it("enriches comments with commenter profile", async () => {
      const profile = {
        did: "did:plc:commenter",
        handle: "commenter.bsky.social",
        displayName: "Commenter",
        avatar: "https://avatar.url",
      };
      mockGetProfiles.mockResolvedValue(new Map([["did:plc:commenter", profile]]));

      const rows = [createCommentRow()];
      const result = await enrichComments(rows);

      expect(result).toHaveLength(1);
      expect(result[0].commenter).toEqual({
        did: "did:plc:commenter",
        handle: "commenter.bsky.social",
        displayName: "Commenter",
        avatar: "https://avatar.url",
      });
    });

    it("handles missing profile", async () => {
      mockGetProfiles.mockResolvedValue(new Map());

      const rows = [createCommentRow()];
      const result = await enrichComments(rows);

      expect(result[0].commenter).toBeUndefined();
    });
  });
});
