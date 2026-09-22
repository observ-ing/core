import { describe, it, expect } from "vitest";
import { getExternalRecordLabel, getExternalRecordHref } from "./externalRecords";

describe("getExternalRecordLabel", () => {
  it("uses the display name for a known service", () => {
    expect(
      getExternalRecordLabel({
        uri: "https://www.inaturalist.org/observations/123456789",
        service: "inaturalist",
      }),
    ).toBe("iNaturalist");
    expect(
      getExternalRecordLabel({ uri: "https://bugguide.net/node/view/1", service: "BugGuide" }),
    ).toBe("BugGuide");
  });

  it("falls back to the host when the service is unknown or absent", () => {
    // The lexicon's known values are not exhaustive, and `service` is
    // optional — neither case should degrade to a raw URL.
    expect(getExternalRecordLabel({ uri: "https://observation.org/observation/1" })).toBe(
      "observation.org",
    );
    expect(
      getExternalRecordLabel({ uri: "https://www.inaturalist.nz/observations/1", service: "inat" }),
    ).toBe("inaturalist.nz");
  });

  it("labels an at:// record generically when it has no service", () => {
    // at-uris have no host to fall back on.
    expect(
      getExternalRecordLabel({ uri: "at://did:plc:abc/app.gainforest.dwc.occurrence/3mu2" }),
    ).toBe("AT Protocol record");
  });

  it("uses the service identifier for an at:// record that names one", () => {
    expect(
      getExternalRecordLabel({
        uri: "at://did:plc:abc/app.gainforest.dwc.occurrence/3mu2",
        service: "gainforest",
      }),
    ).toBe("gainforest");
  });
});

describe("getExternalRecordHref", () => {
  it("links http(s) records", () => {
    expect(getExternalRecordHref("https://www.inaturalist.org/observations/1")).toBe(
      "https://www.inaturalist.org/observations/1",
    );
    expect(getExternalRecordHref("http://example.org/1")).toBe("http://example.org/1");
  });

  it("does not link schemes a browser can't follow", () => {
    // Which appview should render an at-uri isn't ours to guess.
    expect(getExternalRecordHref("at://did:plc:abc/app.gainforest.dwc.occurrence/3mu2")).toBeNull();
    expect(getExternalRecordHref("javascript:alert(1)")).toBeNull();
    expect(getExternalRecordHref("not a uri")).toBeNull();
  });
});
