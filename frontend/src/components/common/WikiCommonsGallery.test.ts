import { describe, it, expect } from "vitest";
import { decodeHtmlText } from "./WikiCommonsGallery.js";

describe("decodeHtmlText", () => {
  it("decodes &amp; entity", () => {
    expect(decodeHtmlText("Andy Reago &amp; Chrissy McClarren")).toBe(
      "Andy Reago & Chrissy McClarren",
    );
  });

  it("decodes other common entities", () => {
    expect(decodeHtmlText("&lt;script&gt;")).toBe("<script>");
    expect(decodeHtmlText("O&#39;Brien")).toBe("O'Brien");
    expect(decodeHtmlText("&quot;quoted&quot;")).toBe('"quoted"');
  });

  it("strips HTML tags and decodes entities", () => {
    expect(decodeHtmlText('<a href="https://example.com">John &amp; Jane</a>')).toBe("John & Jane");
  });

  it("returns empty string for empty input", () => {
    expect(decodeHtmlText("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(decodeHtmlText("John Smith")).toBe("John Smith");
  });
});
