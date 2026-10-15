import { describe, it, expect } from "vitest";
import { nativeBounceTarget } from "./nativeBounce";

describe("nativeBounceTarget", () => {
  it("returns to the app's home after logging in", () => {
    expect(nativeBounceTarget("?just-authed=1")).toBe("https://localhost/");
  });

  it("returns to settings after linking iNaturalist, keeping the outcome", () => {
    expect(nativeBounceTarget("?inat-linked=1")).toBe("https://localhost/settings?inat-linked=1");
    expect(nativeBounceTarget("?inat-error=1")).toBe("https://localhost/settings?inat-error=1");
  });

  it("stays put on any other page", () => {
    expect(nativeBounceTarget("")).toBeNull();
    expect(nativeBounceTarget("?q=oak")).toBeNull();
    expect(nativeBounceTarget("?just-authed=0")).toBeNull();
  });
});
