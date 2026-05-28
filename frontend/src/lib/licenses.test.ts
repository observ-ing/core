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
    expect(isLicenseValue("CC-BY-3.0")).toBe(false);
    expect(isLicenseValue("MIT")).toBe(false);
    expect(isLicenseValue("")).toBe(false);
  });
});

describe("getLicenseLabel", () => {
  it("returns the human-readable label for a known value", () => {
    expect(getLicenseLabel("CC0-1.0")).toBe("CC0 (Public Domain)");
    expect(getLicenseLabel("CC-BY-4.0")).toBe("CC BY (Attribution)");
  });

  it("returns the input verbatim for an unknown value", () => {
    // Intentional: records written by other clients may carry SPDX
    // identifiers outside our allow-list, and we still want to render them.
    expect(getLicenseLabel("CC-BY-3.0")).toBe("CC-BY-3.0");
    expect(getLicenseLabel("Apache-2.0")).toBe("Apache-2.0");
  });

  it("returns the empty string verbatim", () => {
    expect(getLicenseLabel("")).toBe("");
  });
});
