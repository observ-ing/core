import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TaxaAutocompleteView } from "./TaxaAutocompleteView";
import type { TaxaResult } from "../../services/types";

const loquat: TaxaResult = {
  id: "Plantae/Rhaphiolepis bibas",
  scientificName: "Rhaphiolepis bibas",
  commonName: "Loquat",
  rank: "species",
  kingdom: "Plantae",
  source: "gbif",
  matchedSynonym: "Eriobotrya japonica",
};

function renderWith(options: TaxaResult[]) {
  const noop = () => undefined;
  render(
    <TaxaAutocompleteView
      value="eriobotrya japonica"
      onChange={noop}
      options={options}
      loading={false}
      open
      onSearch={noop}
      onClear={noop}
    />,
  );
}

describe("TaxaAutocompleteView", () => {
  afterEach(cleanup);

  it("names the synonym a result matched, alongside its common name", () => {
    renderWith([loquat]);

    expect(screen.getByText("Eriobotrya japonica")).toBeTruthy();
    expect(screen.getByText(/syn\./)).toBeTruthy();
    expect(screen.getByText("Loquat")).toBeTruthy();
  });

  it("names no synonym when the result matched by its own names", () => {
    const { matchedSynonym: _, ...plain } = loquat;
    renderWith([plain]);

    expect(screen.queryByText(/syn\./)).toBeNull();
  });
});
