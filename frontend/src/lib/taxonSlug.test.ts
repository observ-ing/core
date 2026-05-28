import { describe, it, expect } from "vitest";
import { nameToSlug, slugToName } from "./taxonSlug";

describe("nameToSlug", () => {
  it("replaces spaces with hyphens", () => {
    expect(nameToSlug("Quercus alba")).toBe("Quercus-alba");
  });

  it("handles multi-word names with multiple spaces", () => {
    expect(nameToSlug("Homo sapiens sapiens")).toBe("Homo-sapiens-sapiens");
  });

  it("leaves names without spaces unchanged", () => {
    expect(nameToSlug("Plantae")).toBe("Plantae");
  });

  it("returns the empty string unchanged", () => {
    expect(nameToSlug("")).toBe("");
  });

  it("preserves existing hyphens", () => {
    expect(nameToSlug("Homo neanderthalensis")).toBe("Homo-neanderthalensis");
    expect(nameToSlug("X-Y Z")).toBe("X-Y-Z");
  });
});

describe("slugToName", () => {
  it("replaces hyphens with spaces", () => {
    expect(slugToName("Quercus-alba")).toBe("Quercus alba");
  });

  it("leaves slugs without hyphens unchanged", () => {
    expect(slugToName("Plantae")).toBe("Plantae");
  });

  it("returns the empty string unchanged", () => {
    expect(slugToName("")).toBe("");
  });
});

describe("nameToSlug / slugToName round-trip", () => {
  // The pair is *not* a perfect inverse — a name already containing hyphens
  // round-trips to a different string. These tests pin that behavior so any
  // future change to use a reversible encoding is intentional.
  it("round-trips a space-only name", () => {
    const name = "Quercus alba";
    expect(slugToName(nameToSlug(name))).toBe(name);
  });

  it("does NOT round-trip a name containing hyphens (known limitation)", () => {
    const name = "Foo-bar baz";
    // After encode: "Foo-bar-baz". After decode: "Foo bar baz" — hyphen lost.
    expect(slugToName(nameToSlug(name))).toBe("Foo bar baz");
  });
});
