import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VisualIdCards } from "./VisualIdCards";
import type { IdentifyFallback, SpeciesSuggestion } from "../../services/api";
import type { TaxaResult } from "../../services/types";

const lineage = {
  kingdom: "Animalia",
  phylum: "Arthropoda",
  class: "Insecta",
  order: "Hymenoptera",
  family: "Apidae",
  genus: "Bombus",
};

const bees: SpeciesSuggestion[] = [
  { scientificName: "Bombus impatiens", confidence: 0.29, ...lineage },
  { scientificName: "Bombus vagans", confidence: 0.28, ...lineage },
];

const bombusMatch: TaxaResult = {
  id: "Animalia/Bombus",
  taxonId: "https://www.gbif.org/species/1340278",
  scientificName: "Bombus",
  rank: "genus",
  kingdom: "Animalia",
  source: "gbif",
};

const fallback: IdentifyFallback = {
  rank: "genus",
  scientificName: "Bombus",
  confidence: 0.86,
  kingdom: "Animalia",
  family: "Apidae",
  commonName: "Bumble bees",
  taxonMatch: bombusMatch,
};

describe("VisualIdCards", () => {
  afterEach(cleanup);

  it("leads with the server's fallback and selects its GBIF match", () => {
    const onSelectAncestor = vi.fn();
    render(
      <VisualIdCards
        suggestions={bees}
        fallback={fallback}
        onSelectSpecies={() => undefined}
        onSelectAncestor={onSelectAncestor}
      />,
    );

    expect(screen.getByText("Bumble bees")).toBeTruthy();
    expect(screen.getByText(/86% likely/)).toBeTruthy();
    expect(screen.getByText("If you can tell which species:")).toBeTruthy();

    fireEvent.click(screen.getByText(/86% likely/));
    expect(onSelectAncestor).toHaveBeenCalledWith({
      rank: "genus",
      name: "Bombus",
      kingdom: "Animalia",
      match: bombusMatch,
    });
  });

  it("uses the server's fallback even when one species looks dominant", () => {
    const dominant: SpeciesSuggestion[] = [
      { scientificName: "Bombus impatiens", confidence: 0.8, ...lineage },
      { scientificName: "Bombus vagans", confidence: 0.1, ...lineage },
    ];
    render(
      <VisualIdCards
        suggestions={dominant}
        fallback={fallback}
        onSelectSpecies={() => undefined}
        onSelectAncestor={() => undefined}
      />,
    );

    expect(screen.getByText(/86% likely/)).toBeTruthy();
    expect(screen.queryByText("Other candidates:")).toBeNull();
  });

  it("gives a kingdom fallback its own name as the kingdom", () => {
    const onSelectAncestor = vi.fn();
    render(
      <VisualIdCards
        suggestions={bees}
        fallback={{ rank: "kingdom", scientificName: "Animalia", confidence: 0.9 }}
        onSelectSpecies={() => undefined}
        onSelectAncestor={onSelectAncestor}
      />,
    );

    fireEvent.click(screen.getByText(/90% likely/));
    expect(onSelectAncestor).toHaveBeenCalledWith(
      expect.objectContaining({ rank: "kingdom", name: "Animalia", kingdom: "Animalia" }),
    );
  });

  it("works out a common rank itself when the server sends no fallback", () => {
    render(
      <VisualIdCards
        suggestions={bees}
        onSelectSpecies={() => undefined}
        onSelectAncestor={() => undefined}
      />,
    );

    expect(screen.getByText(/Genus · 57% match/)).toBeTruthy();
  });
});
