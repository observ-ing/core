import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdentificationService, type IdentificationAgent } from "./identification.js";

describe("IdentificationService", () => {
  let createRecord: ReturnType<
    typeof vi.fn<IdentificationAgent["com"]["atproto"]["repo"]["createRecord"]>
  >;
  let deleteRecord: ReturnType<
    typeof vi.fn<IdentificationAgent["com"]["atproto"]["repo"]["deleteRecord"]>
  >;
  let getRecord: ReturnType<
    typeof vi.fn<IdentificationAgent["com"]["atproto"]["repo"]["getRecord"]>
  >;
  let putRecord: ReturnType<
    typeof vi.fn<IdentificationAgent["com"]["atproto"]["repo"]["putRecord"]>
  >;
  let listRecords: ReturnType<
    typeof vi.fn<IdentificationAgent["com"]["atproto"]["repo"]["listRecords"]>
  >;
  let service: IdentificationService;

  function makeAgent(session: IdentificationAgent["session"]): IdentificationAgent {
    return {
      session,
      com: {
        atproto: {
          repo: { createRecord, deleteRecord, getRecord, putRecord, listRecords },
        },
      },
    };
  }
  const defaultSession = { did: "did:plc:test" };

  beforeEach(() => {
    createRecord = vi.fn(async () => ({
      success: true,
      data: {
        uri: "at://did:plc:test/bio.lexicons.temp.identification/1",
        cid: "test-cid",
        commit: { cid: "commit-cid", rev: "rev-1" },
        validationStatus: "valid",
      },
      headers: {},
    }));
    deleteRecord = vi.fn(async () => ({
      success: true,
      data: { commit: { cid: "commit-cid", rev: "rev-1" } },
      headers: {},
    }));
    getRecord = vi.fn(async () => ({
      success: true,
      data: {
        uri: "at://did:plc:test/bio.lexicons.temp.identification/1",
        cid: "test-cid",
        value: {
          $type: "bio.lexicons.temp.identification",
          occurrence: {
            uri: "at://did:plc:test/bio.lexicons.temp.occurrence/1",
            cid: "subject-cid",
          },
          scientificName: "Quercus alba",
          taxonRank: "species",
          createdAt: "2024-01-01T00:00:00Z",
        },
      },
      headers: {},
    }));
    putRecord = vi.fn(async () => ({
      success: true,
      data: {
        uri: "at://did:plc:test/bio.lexicons.temp.identification/1",
        cid: "new-cid",
        commit: { cid: "commit-cid", rev: "rev-1" },
        validationStatus: "valid",
      },
      headers: {},
    }));
    listRecords = vi.fn(async () => ({
      success: true,
      data: { records: [] },
      headers: {},
    }));
    service = new IdentificationService(makeAgent(defaultSession));
  });

  describe("validateInput", () => {
    const validInput = {
      occurrenceUri: "at://did:plc:test/bio.lexicons.temp.occurrence/1",
      occurrenceCid: "bafyrei123",
      scientificName: "Quercus alba",
    };

    describe("occurrenceUri validation", () => {
      it("throws if occurrenceUri is missing", async () => {
        await expect(service.identify({ ...validInput, occurrenceUri: "" })).rejects.toThrow(
          "Occurrence URI is required",
        );
      });

      it("throws if occurrenceUri does not start with at://", async () => {
        await expect(
          service.identify({ ...validInput, occurrenceUri: "https://example.com/post" }),
        ).rejects.toThrow("Invalid occurrence URI format");
      });

      it("accepts valid at:// URI", async () => {
        await service.identify(validInput);
        expect(createRecord).toHaveBeenCalled();
      });
    });

    describe("occurrenceCid validation", () => {
      it("throws if occurrenceCid is missing", async () => {
        await expect(service.identify({ ...validInput, occurrenceCid: "" })).rejects.toThrow(
          "Occurrence CID is required",
        );
      });
    });

    describe("scientificName validation", () => {
      it("throws if scientificName is missing", async () => {
        await expect(service.identify({ ...validInput, scientificName: "" })).rejects.toThrow(
          "Scientific name is required",
        );
      });

      it("throws if scientificName is whitespace only", async () => {
        await expect(service.identify({ ...validInput, scientificName: "   " })).rejects.toThrow(
          "Scientific name is required",
        );
      });

      it("throws if scientificName exceeds 256 characters", async () => {
        const longName = "A".repeat(257);
        await expect(service.identify({ ...validInput, scientificName: longName })).rejects.toThrow(
          "Scientific name too long (max 256 characters)",
        );
      });

      it("accepts scientificName at exactly 256 characters", async () => {
        const maxName = "A".repeat(256);
        await service.identify({ ...validInput, scientificName: maxName });
        expect(createRecord).toHaveBeenCalled();
      });
    });
  });

  describe("identify", () => {
    it("throws if not logged in", async () => {
      const noSessionService = new IdentificationService(makeAgent(undefined));

      await expect(
        noSessionService.identify({
          occurrenceUri: "at://did:plc:test/bio.lexicons.temp.occurrence/1",
          occurrenceCid: "bafyrei123",
          scientificName: "Quercus alba",
        }),
      ).rejects.toThrow("Not logged in");
    });

    it("returns uri and cid on success", async () => {
      const result = await service.identify({
        occurrenceUri: "at://did:plc:test/bio.lexicons.temp.occurrence/1",
        occurrenceCid: "bafyrei123",
        scientificName: "Quercus alba",
      });

      expect(result).toEqual({
        uri: "at://did:plc:test/bio.lexicons.temp.identification/1",
        cid: "test-cid",
      });
    });

    it("creates record with flat structure (no nested taxon)", async () => {
      await service.identify({
        occurrenceUri: "at://did:plc:test/bio.lexicons.temp.occurrence/1",
        occurrenceCid: "bafyrei123",
        scientificName: "Quercus alba",
        taxonRank: "species",
        isAgreement: true,
      });

      expect(createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "did:plc:test",
          collection: "bio.lexicons.temp.identification",
          record: expect.objectContaining({
            $type: "bio.lexicons.temp.identification",
            occurrence: {
              uri: "at://did:plc:test/bio.lexicons.temp.occurrence/1",
              cid: "bafyrei123",
            },
            scientificName: "Quercus alba",
            taxonRank: "species",
            isAgreement: true,
          }),
        }),
      );
    });

    it("uses default values when optional fields not provided", async () => {
      await service.identify({
        occurrenceUri: "at://did:plc:test/bio.lexicons.temp.occurrence/1",
        occurrenceCid: "bafyrei123",
        scientificName: "Quercus alba",
      });

      expect(createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            taxonRank: "species", // default
            isAgreement: false, // default
          }),
        }),
      );
    });
  });

  describe("agree", () => {
    it("creates an agreement identification", async () => {
      await service.agree(
        "at://did:plc:test/bio.lexicons.temp.occurrence/1",
        "bafyrei123",
        "Quercus alba",
      );

      expect(createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            scientificName: "Quercus alba",
            isAgreement: true,
          }),
        }),
      );
    });
  });

  describe("suggestId", () => {
    it("creates a non-agreement identification", async () => {
      await service.suggestId(
        "at://did:plc:test/bio.lexicons.temp.occurrence/1",
        "bafyrei123",
        "Quercus rubra",
      );

      expect(createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            scientificName: "Quercus rubra",
            isAgreement: false,
          }),
        }),
      );
    });

    it("accepts optional taxonRank", async () => {
      await service.suggestId(
        "at://did:plc:test/bio.lexicons.temp.occurrence/1",
        "bafyrei123",
        "Quercus rubra",
        { taxonRank: "species" },
      );

      expect(createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            scientificName: "Quercus rubra",
            taxonRank: "species",
          }),
        }),
      );
    });
  });

  describe("withdraw", () => {
    it("throws if not logged in", async () => {
      const noSessionService = new IdentificationService(makeAgent(undefined));

      await expect(
        noSessionService.withdraw("at://did:plc:test/bio.lexicons.temp.identification/abc123"),
      ).rejects.toThrow("Not logged in");
    });

    it("extracts rkey from URI and deletes record", async () => {
      await service.withdraw("at://did:plc:test/bio.lexicons.temp.identification/abc123");

      expect(deleteRecord).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "bio.lexicons.temp.identification",
        rkey: "abc123",
      });
    });
  });

  describe("update", () => {
    it("throws if not logged in", async () => {
      const noSessionService = new IdentificationService(makeAgent(undefined));

      await expect(
        noSessionService.update("at://did:plc:test/bio.lexicons.temp.identification/abc123", {
          scientificName: "Quercus rubra",
        }),
      ).rejects.toThrow("Not logged in");
    });

    it("fetches existing record and updates it", async () => {
      const result = await service.update(
        "at://did:plc:test/bio.lexicons.temp.identification/abc123",
        { scientificName: "Quercus rubra" },
      );

      expect(getRecord).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "bio.lexicons.temp.identification",
        rkey: "abc123",
      });
      expect(putRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "did:plc:test",
          collection: "bio.lexicons.temp.identification",
          rkey: "abc123",
          record: expect.objectContaining({
            scientificName: "Quercus rubra",
          }),
        }),
      );
      expect(result).toEqual({
        uri: "at://did:plc:test/bio.lexicons.temp.identification/1",
        cid: "new-cid",
      });
    });

    it("preserves existing fields when not updated", async () => {
      await service.update("at://did:plc:test/bio.lexicons.temp.identification/abc123", {});

      expect(putRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            scientificName: "Quercus alba", // preserved from existing
            taxonRank: "species", // preserved from existing
          }),
        }),
      );
    });
  });

  describe("getMyIdentifications", () => {
    it("throws if not logged in", async () => {
      const noSessionService = new IdentificationService(makeAgent(undefined));

      await expect(noSessionService.getMyIdentifications()).rejects.toThrow("Not logged in");
    });

    it("lists records with default limit", async () => {
      await service.getMyIdentifications();

      expect(listRecords).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "bio.lexicons.temp.identification",
        limit: 50,
      });
    });

    it("lists records with custom limit", async () => {
      await service.getMyIdentifications(100);

      expect(listRecords).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "bio.lexicons.temp.identification",
        limit: 100,
      });
    });

    it("returns records from response", async () => {
      const mockRecords = [
        { uri: "at://test/1", cid: "cid1", value: { scientificName: "Species A" } },
        { uri: "at://test/2", cid: "cid2", value: { scientificName: "Species B" } },
      ];
      listRecords.mockResolvedValueOnce({
        success: true,
        data: { records: mockRecords },
        headers: {},
      });

      const result = await service.getMyIdentifications();
      expect(result).toEqual(mockRecords);
    });
  });
});
