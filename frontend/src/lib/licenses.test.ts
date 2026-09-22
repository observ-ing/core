import { describe, it, expect } from "vitest";
import { LICENSE_OPTIONS, DEFAULT_LICENSE, isLicenseValue, getLicenseLabel } from "./licenses";

describe("LICENSE_OPTIONS", () => {
  it("exposes a non-empty list of options", () => {
    expect(LICENSE_OPTIONS.length).toBeGreaterThan(0);
  });

  it("has a unique value for each entry", () => {
    const values = LICENSE_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("DEFAULT_LICENSE", () => {
  it("is one of the listed options", () => {
    expect(LICENSE_OPTIONS.some((o) => o.value === DEFAULT_LICENSE)).toBe(true);
  });
});

describe("isLicenseValue", () => {
  it("accepts every listed license value", () => {
    for (const opt of LICENSE_OPTIONS) {
      expect(isLicenseValue(opt.value)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isLicenseValue("https://creativecommons.org/licenses/by/3.0/")).toBe(false);
    expect(isLicenseValue("MIT")).toBe(false);
    expect(isLicenseValue("")).toBe(false);
  });

  it("rejects the retired SPDX identifiers", () => {
    // These still render (see getLicenseLabel) but must never be written.
    expect(isLicenseValue("CC-BY-4.0")).toBe(false);
  });
});

describe("getLicenseLabel", () => {
  it("returns the human-readable label for a known value", () => {
    expect(getLicenseLabel("https://creativecommons.org/publicdomain/zero/1.0/")).toBe(
      "CC0 (Public Domain)",
    );
    expect(getLicenseLabel("https://creativecommons.org/licenses/by/4.0/")).toBe(
      "CC BY (Attribution)",
    );
  });

  it("labels the retired SPDX identifiers", () => {
    // Records written before the lexicon moved to license URIs, or an
    // optimistic cache entry from a stale bundle, still reach the renderer.
    expect(getLicenseLabel("CC0-1.0")).toBe("CC0 (Public Domain)");
    expect(getLicenseLabel("CC-BY-NC-SA-4.0")).toBe(
      "CC BY-NC-SA (Attribution, Non-Commercial, Share-Alike)",
    );
  });

  it("returns the input verbatim for an unknown value", () => {
    // Intentional: records written by other clients may carry licenses
    // outside our allow-list, and we still want to render them.
    expect(getLicenseLabel("https://creativecommons.org/licenses/by/3.0/")).toBe(
      "https://creativecommons.org/licenses/by/3.0/",
    );
    expect(getLicenseLabel("Apache-2.0")).toBe("Apache-2.0");
  });

  it("returns the empty string verbatim", () => {
    expect(getLicenseLabel("")).toBe("");
  });
});
