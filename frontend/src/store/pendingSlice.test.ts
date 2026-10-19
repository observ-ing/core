import { describe, it, expect } from "vitest";
import { isSubmissionIngested } from "./pendingSlice";
import type { Identification, OccurrenceDetailResponse } from "../services/types";

const AUTHOR = "did:plc:author";
const URI = `at://${AUTHOR}/bio.lexicons.temp.v0-1.occurrence/obs1`;
const CID = "bafycid1";

function identification(did: string, scientificName: string): Identification {
  return {
    identifier: { did },
    uri: `at://${did}/bio.lexicons.temp.v0-1.identification/id1`,
    cid: "bafyid1",
    did,
    subject_uri: URI,
    subject_cid: CID,
    scientific_name: scientificName,
    date_identified: "2026-01-01T00:00:00Z",
  };
}

function detail(cid: string, identifications: Identification[]): OccurrenceDetailResponse {
  return {
    occurrence: {
      uri: URI,
      cid,
      observer: { did: AUTHOR },
      identificationCount: identifications.length,
      images: [],
      externalRecords: [],
      createdAt: "2026-01-01T00:00:00Z",
      qualityIssues: [],
    },
    identifications,
    comments: [],
  };
}

describe("isSubmissionIngested", () => {
  const submission = { uri: URI, cid: CID, scientificName: "Quercus alba" };

  it("waits while the occurrence isn't ingested", () => {
    expect(isSubmissionIngested(null, submission)).toBe(false);
  });

  it("waits for the written cid, not an older version", () => {
    const stale = detail("bafyold", [identification(AUTHOR, "Quercus alba")]);
    expect(isSubmissionIngested(stale, submission)).toBe(false);
  });

  // The appview writes the identification as its own record after the
  // occurrence, so the occurrence can be ingested on its own first.
  it("waits for the submitter's identification once the occurrence lands", () => {
    expect(isSubmissionIngested(detail(CID, []), submission)).toBe(false);
    expect(
      isSubmissionIngested(
        detail(CID, [identification("did:plc:other", "Quercus alba")]),
        submission,
      ),
    ).toBe(false);
    expect(
      isSubmissionIngested(detail(CID, [identification(AUTHOR, "Quercus rubra")]), submission),
    ).toBe(false);
    expect(
      isSubmissionIngested(detail(CID, [identification(AUTHOR, "Quercus alba")]), submission),
    ).toBe(true);
  });

  it("needs only the occurrence when no taxon was named", () => {
    expect(isSubmissionIngested(detail(CID, []), { uri: URI, cid: CID })).toBe(true);
  });
});
