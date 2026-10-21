import { describe, it, expect } from "vitest";
import { browserUtcOffset, formatUtcOffset, taxonFields, toEventDate } from "./observationInput";

describe("formatUtcOffset", () => {
  it("formats an offset in minutes east of UTC as ±HH:MM", () => {
    expect(formatUtcOffset(-420)).toBe("-07:00");
    expect(formatUtcOffset(345)).toBe("+05:45");
    expect(formatUtcOffset(0)).toBe("+00:00");
  });
});

describe("toEventDate", () => {
  it("reads the clock time in the offset it was recorded in", () => {
    expect(toEventDate({ date: "2026-10-03T10:42", endDate: "", utcOffset: "-07:00" })).toBe(
      "2026-10-03T17:42:00.000Z",
    );
    expect(toEventDate({ date: "2026-10-03T10:42", endDate: "", utcOffset: "+05:45" })).toBe(
      "2026-10-03T04:57:00.000Z",
    );
  });

  it("reads the clock time in the browser's zone without an offset", () => {
    const date = "2026-10-03T10:42";
    expect(toEventDate({ date, endDate: "", utcOffset: null })).toBe(
      toEventDate({ date, endDate: "", utcOffset: browserUtcOffset(date) }),
    );
  });

  it("sends a day range when there is an end date, whatever the zone", () => {
    expect(
      toEventDate({ date: "2026-10-03T10:42", endDate: "2026-10-05", utcOffset: "-07:00" }),
    ).toBe("2026-10-03/2026-10-05");
  });
});

describe("taxonFields", () => {
  const match = {
    id: "hippodamia-convergens",
    taxonId: "gbif:1",
    scientificName: "Hippodamia convergens",
    rank: "species",
  };

  it("sends a matched taxon's id and leaves out the rank", () => {
    expect(
      taxonFields({ name: " Hippodamia convergens ", match, kingdom: "Animalia", rank: "genus" }),
    ).toEqual({ scientificName: "Hippodamia convergens", kingdom: "Animalia", taxonId: "gbif:1" });
  });

  it("sends the chosen kingdom and rank for free text", () => {
    expect(
      taxonFields({ name: "Hippodamia sp. A", match: null, kingdom: "Animalia", rank: "species" }),
    ).toEqual({ scientificName: "Hippodamia sp. A", kingdom: "Animalia", taxonRank: "species" });
  });

  it("sends nothing for a blank name", () => {
    expect(taxonFields({ name: "  ", match, kingdom: "Animalia", rank: "species" })).toEqual({});
  });
});
