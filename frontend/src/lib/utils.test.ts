import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimeAgo,
  formatRelativeTime,
  formatDate,
  formatEventDate,
  getPdslsUrl,
  parseAtUri,
  getObservationUrl,
  buildOccurrenceAtUri,
  getDisplayName,
  getErrorMessage,
} from "./utils";

// Anchor "now" so the relative-time tests are deterministic.
const NOW = new Date("2024-06-15T12:00:00Z");

describe("formatTimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'now' for dates within the last minute", () => {
    expect(formatTimeAgo(new Date(NOW.getTime() - 30_000))).toBe("now");
    expect(formatTimeAgo(NOW)).toBe("now");
  });

  it("returns minutes for dates within the last hour", () => {
    expect(formatTimeAgo(new Date(NOW.getTime() - 60_000))).toBe("1m");
    expect(formatTimeAgo(new Date(NOW.getTime() - 45 * 60_000))).toBe("45m");
  });

  it("returns hours for dates within the last day", () => {
    expect(formatTimeAgo(new Date(NOW.getTime() - 60 * 60_000))).toBe("1h");
    expect(formatTimeAgo(new Date(NOW.getTime() - 23 * 60 * 60_000))).toBe("23h");
  });

  it("returns days for dates within the last week", () => {
    expect(formatTimeAgo(new Date(NOW.getTime() - 24 * 60 * 60_000))).toBe("1d");
    expect(formatTimeAgo(new Date(NOW.getTime() - 6 * 24 * 60 * 60_000))).toBe("6d");
  });

  it("returns a localized date for dates older than a week", () => {
    const monthOld = new Date(NOW.getTime() - 30 * 24 * 60 * 60_000);
    const out = formatTimeAgo(monthOld);
    // Should NOT match the compact relative format ("Xm" / "Xh" / "Xd" / "now").
    expect(out).not.toMatch(/^(now|\d+[mhd])$/);
    expect(out).not.toBe("");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for dates within the last minute", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 30_000).toISOString())).toBe("just now");
  });

  it("returns minutes for dates within the last hour", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000).toISOString())).toBe("5m ago");
  });

  it("returns hours for dates within the last day", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString())).toBe(
      "3h ago",
    );
  });

  it("returns days for dates within the last week", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 4 * 24 * 60 * 60_000).toISOString())).toBe(
      "4d ago",
    );
  });

  it("returns a localized date for dates older than a week", () => {
    const yearOld = new Date(NOW.getTime() - 365 * 24 * 60 * 60_000).toISOString();
    const out = formatRelativeTime(yearOld);
    expect(out).not.toMatch(/ ago$/);
    expect(out).not.toBe("");
  });
});

describe("formatDate", () => {
  it("returns a non-empty localized string for a valid date", () => {
    const out = formatDate("2024-01-15T00:00:00Z");
    // Locale varies by host, but the year should always appear.
    expect(out).toContain("2024");
    expect(out.length).toBeGreaterThan("2024".length);
  });
});

describe("formatEventDate", () => {
  it("shows reduced precision verbatim", () => {
    expect(formatEventDate("1971")).toBe("1971");
  });

  it("formats year-month without a day", () => {
    const out = formatEventDate("1906-06");
    expect(out).toContain("1906");
    expect(out).not.toContain("31");
  });

  it("formats a date-only value in UTC (no day shift)", () => {
    // Regardless of host timezone, the 8th must not slip to the 7th.
    expect(formatEventDate("1963-03-08")).toContain("8");
    expect(formatEventDate("1963-03-08")).toContain("1963");
  });

  it("renders an interval as start – end", () => {
    const out = formatEventDate("1995-05-21/1995-05-23");
    expect(out).toContain(" – ");
    expect(out).toContain("21");
    expect(out).toContain("23");
  });

  it("returns unparseable input verbatim", () => {
    expect(formatEventDate("not a date")).toBe("not a date");
  });
});

describe("getPdslsUrl", () => {
  it("prepends the pdsls.dev base", () => {
    expect(getPdslsUrl("at://did:plc:abc/coll/rkey")).toBe(
      "https://pdsls.dev/at://did:plc:abc/coll/rkey",
    );
  });
});

describe("parseAtUri", () => {
  it("parses a well-formed AT URI into its components", () => {
    expect(parseAtUri("at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/rkey1")).toEqual({
      did: "did:plc:abc123",
      collection: "bio.lexicons.temp.v0-1.occurrence",
      rkey: "rkey1",
    });
  });

  it("returns null for the empty string", () => {
    expect(parseAtUri("")).toBeNull();
  });

  it("returns null for a URI missing parts", () => {
    expect(parseAtUri("at://did:plc:abc")).toBeNull();
    expect(parseAtUri("at://did:plc:abc/collection")).toBeNull();
  });

  it("returns null when the URI has extra path segments", () => {
    expect(parseAtUri("at://did:plc:abc/coll/rkey/extra")).toBeNull();
  });

  it("returns null for non-at: schemes", () => {
    expect(parseAtUri("https://example.com/foo/bar/baz")).toBeNull();
  });
});

describe("getObservationUrl", () => {
  it("produces an /observation/<did>/<rkey> path for a well-formed AT URI", () => {
    expect(getObservationUrl("at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3kabc")).toBe(
      "/observation/did:plc:abc/3kabc",
    );
  });

  it("falls back to encoding the raw URI when parsing fails", () => {
    expect(getObservationUrl("not-an-at-uri")).toBe("/observation/not-an-at-uri");
    // Slashes inside an unparseable input must be percent-encoded so they
    // don't add extra route segments.
    expect(getObservationUrl("at://broken")).toBe("/observation/at%3A%2F%2Fbroken");
  });
});

describe("buildOccurrenceAtUri", () => {
  it("round-trips with parseAtUri", () => {
    const did = "did:plc:abc123";
    const rkey = "3kabcdef";
    const uri = buildOccurrenceAtUri(did, rkey);
    const parsed = parseAtUri(uri);
    expect(parsed).toEqual({
      did,
      collection: "bio.lexicons.temp.v0-1.occurrence",
      rkey,
    });
  });
});

describe("getDisplayName", () => {
  it("prefers displayName when set", () => {
    expect(
      getDisplayName({
        displayName: "Alice",
        handle: "alice.bsky.social",
        did: "did:plc:abc",
      }),
    ).toBe("Alice");
  });

  it("falls back to handle when displayName is missing", () => {
    expect(getDisplayName({ handle: "alice.bsky.social", did: "did:plc:abc" })).toBe(
      "alice.bsky.social",
    );
  });

  it("falls back to a truncated DID when both displayName and handle are missing", () => {
    expect(getDisplayName({ did: "did:plc:abcdefghijklmnopqrstuvwxyz" })).toBe(
      "did:plc:abcdefghijkl",
    );
  });

  it("falls back to the default fallback string when nothing is present", () => {
    expect(getDisplayName({})).toBe("Unknown");
  });

  it("uses a caller-provided fallback when nothing is present", () => {
    expect(getDisplayName({}, "Anonymous")).toBe("Anonymous");
  });

  it("treats null/empty values as absent (falls through the chain)", () => {
    expect(getDisplayName({ displayName: null, handle: "", did: "did:plc:abc" })).toBe(
      "did:plc:abc",
    );
  });
});

describe("getErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the fallback for non-Error values", () => {
    expect(getErrorMessage("a string error")).toBe("Unknown error");
    expect(getErrorMessage(undefined)).toBe("Unknown error");
    expect(getErrorMessage(null)).toBe("Unknown error");
    expect(getErrorMessage({ message: "looks like an error" })).toBe("Unknown error");
  });

  it("uses a caller-provided fallback", () => {
    expect(getErrorMessage(undefined, "Something went wrong")).toBe("Something went wrong");
  });
});
