import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import type { IdentifyFallback, SpeciesSuggestion } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { buildTaxonUrl } from "../../lib/taxonSlug";
import { ExternalLinkIconButton } from "../common/ExternalLinkIconButton";
import { InRangeIndicator } from "../common/InRangeIndicator";
import { TaxonThumbnail } from "../common/TaxonThumbnail";
import { miniIconSx, tallRowMinHeight } from "../common/layoutSx";

/**
 * Ranks we'll roll up to, ordered from most specific to most general.
 * Capped at kingdom — anything broader (domain, life) isn't a useful ID.
 */
const RANK_ORDER = ["genus", "family", "order", "class", "phylum", "kingdom"] as const;
type AncestorRank = (typeof RANK_ORDER)[number];

const RANK_INITIAL: Record<AncestorRank, string> = {
  genus: "G",
  family: "F",
  order: "O",
  class: "C",
  phylum: "P",
  kingdom: "K",
};

const RANK_LABEL: Record<AncestorRank, string> = {
  genus: "Genus",
  family: "Family",
  order: "Order",
  class: "Class",
  phylum: "Phylum",
  kingdom: "Kingdom",
};

interface AncestorMatch {
  rank: AncestorRank;
  name: string;
  kingdom: string | undefined;
  /**
   * From the server: the share of the model's probability on this taxon.
   * Worked out here: the sum of the candidates' confidences.
   */
  confidence: number;
  /** Whether the server picked this rank, rather than `findCommonAncestor`. */
  fromServer: boolean;
  commonName?: string | undefined;
  /** The GBIF taxon the name resolved to, when the server found one. */
  match?: TaxaResult | undefined;
}

export interface AncestorSelection {
  rank: AncestorRank;
  name: string;
  kingdom: string | undefined;
  /** Set when the name resolved to a known taxon; pick it like a search result. */
  match?: TaxaResult | undefined;
}

type Mode = "single" | "dominant" | "ambiguous";

/**
 * Trigger thresholds for "dominant" mode (one species clearly wins).
 * Top must be both ≥ 50% absolute AND ≥ 2× the runner-up.
 * Failing either gate, we fall into "ambiguous" mode and offer the ancestor.
 */
const DOMINANT_FLOOR = 0.5;
const DOMINANT_GAP = 2;

function determineMode(sortedByConfidence: SpeciesSuggestion[]): Mode {
  const top = sortedByConfidence[0];
  const runnerUp = sortedByConfidence[1];
  if (!top || !runnerUp) return "single";
  return top.confidence >= DOMINANT_FLOOR && top.confidence >= DOMINANT_GAP * runnerUp.confidence
    ? "dominant"
    : "ambiguous";
}

// Shared shape for the suggestion-row ButtonBase in AncestorCard and
// SpeciesCard — layout stays identical; only sizing/color varies by row.
const SUGGESTION_ROW_BASE_SX = {
  width: "100%",
  textAlign: "left" as const,
  borderRadius: 1,
  border: "1px solid",
  display: "flex",
  alignItems: "center",
  gap: 1.25,
};

function TaxonLinkButton({ url, taxonName }: { url: string; taxonName: string }) {
  return <ExternalLinkIconButton href={url} label={taxonName} sx={{ ml: 0.5 }} />;
}

/**
 * The server's fallback rank. It weighs every species the model knows rather
 * than just the few suggestions sent here, so it's preferred over
 * `findCommonAncestor` whenever the server sends one.
 */
function ancestorFromFallback(fallback: IdentifyFallback): AncestorMatch {
  return {
    rank: fallback.rank,
    name: fallback.scientificName,
    // Only the ranks above `rank` are set, so a kingdom is its own kingdom.
    kingdom:
      fallback.kingdom ?? (fallback.rank === "kingdom" ? fallback.scientificName : undefined),
    confidence: fallback.confidence,
    fromServer: true,
    commonName: fallback.commonName ?? fallback.taxonMatch?.commonName,
    match: fallback.taxonMatch,
  };
}

function findCommonAncestor(suggestions: SpeciesSuggestion[]): AncestorMatch | null {
  if (suggestions.length < 2) return null;
  const first = suggestions[0];
  if (!first) return null;
  for (const rank of RANK_ORDER) {
    const values = suggestions.map((s) => s[rank]);
    const allPresent = values.every((v): v is string => typeof v === "string" && v.length > 0);
    if (!allPresent || new Set(values).size !== 1) continue;
    const name = values[0];
    if (!name) continue;
    return {
      rank,
      name,
      kingdom: first.kingdom,
      fromServer: false,
      // Cap at 1.0: model output isn't always probability-normalized, so the
      // raw sum of candidate confidences can exceed 100%.
      confidence: Math.min(
        1,
        suggestions.reduce((sum, s) => sum + s.confidence, 0),
      ),
    };
  }
  return null;
}

interface VisualIdCardsProps {
  suggestions: SpeciesSuggestion[];
  /**
   * The server's broader rank for when no species is confident. When set,
   * it leads the list in place of the rank worked out from `suggestions`.
   */
  fallback?: IdentifyFallback | undefined;
  onSelectSpecies: (suggestion: SpeciesSuggestion) => void;
  onSelectAncestor: (ancestor: AncestorSelection) => void;
}

export function VisualIdCards({
  suggestions,
  fallback,
  onSelectSpecies,
  onSelectAncestor,
}: VisualIdCardsProps) {
  const serverAncestor = fallback ? ancestorFromFallback(fallback) : null;
  const sorted = [...suggestions].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  if (!top && !serverAncestor) return null;
  const rest = sorted.slice(1);
  // The server only sends a fallback when no species is confident on its own.
  const mode: Mode = serverAncestor ? "ambiguous" : determineMode(sorted);
  const ancestor = serverAncestor ?? (mode !== "single" ? findCommonAncestor(sorted) : null);

  const ancestorSelection: AncestorSelection | null = ancestor
    ? { rank: ancestor.rank, name: ancestor.name, kingdom: ancestor.kingdom, match: ancestor.match }
    : null;

  return (
    <Box>
      <SectionHeader />
      {mode === "single" && top && (
        <SpeciesCard suggestion={top} primary onSelect={() => onSelectSpecies(top)} />
      )}

      {mode === "dominant" && top && (
        <Stack spacing={0.75}>
          <SpeciesCard suggestion={top} primary onSelect={() => onSelectSpecies(top)} />
          {rest.length > 0 && (
            <>
              <SectionLabel text="Other candidates:" />
              <Stack spacing={0.5}>
                {rest.map((s) => (
                  <SpeciesCard
                    key={s.scientificName}
                    suggestion={s}
                    onSelect={() => onSelectSpecies(s)}
                  />
                ))}
              </Stack>
              {ancestor && ancestorSelection && (
                <AncestorAffordance
                  ancestor={ancestor}
                  onSelect={() => onSelectAncestor(ancestorSelection)}
                />
              )}
            </>
          )}
        </Stack>
      )}

      {mode === "ambiguous" && (
        <Stack spacing={0.75}>
          {ancestor && ancestorSelection && (
            <AncestorCard
              ancestor={ancestor}
              onSelect={() => onSelectAncestor(ancestorSelection)}
            />
          )}
          {sorted.length > 0 && (
            <>
              <SectionLabel
                text={ancestor ? "If you can tell which species:" : "Possible species:"}
              />
              <Stack spacing={0.5}>
                {sorted.map((s) => (
                  <SpeciesCard
                    key={s.scientificName}
                    suggestion={s}
                    onSelect={() => onSelectSpecies(s)}
                  />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      )}
    </Box>
  );
}

function SectionHeader() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
      <AutoFixHighIcon sx={{ ...miniIconSx, color: "text.secondary" }} />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        Visual matches
      </Typography>
    </Box>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.5, mb: 0.25 }}>
      {text}
    </Typography>
  );
}

function RankChip({ rank, size = 40 }: { rank: AncestorRank; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: "action.selected",
        color: "text.secondary",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontWeight: 600,
        fontSize: size >= 36 ? "0.875rem" : "0.7rem",
      }}
      aria-label={RANK_LABEL[rank]}
    >
      {RANK_INITIAL[rank]}
    </Box>
  );
}

function AncestorName({ ancestor }: { ancestor: AncestorMatch }) {
  // "sp." convention applies at genus level. For higher ranks (family, order, etc.)
  // the rank chip + label is enough; "Aves sp." reads awkwardly to most readers.
  if (ancestor.rank === "genus") {
    return (
      <>
        <Box component="span" sx={{ fontStyle: "italic" }}>
          {ancestor.name}
        </Box>{" "}
        sp.
      </>
    );
  }
  return <>{ancestor.name}</>;
}

function AncestorCard({ ancestor, onSelect }: { ancestor: AncestorMatch; onSelect: () => void }) {
  const url = buildTaxonUrl(
    ancestor.name,
    ancestor.kingdom,
    ancestor.rank,
    ancestor.match?.taxonId,
  );
  const photoUrl = ancestor.match?.photoUrl;
  const percent = Math.round(ancestor.confidence * 100);
  return (
    <ButtonBase
      onClick={onSelect}
      sx={{
        ...SUGGESTION_ROW_BASE_SX,
        borderColor: "primary.main",
        bgcolor: "action.hover",
        p: 1.25,
        minHeight: tallRowMinHeight,
        "&:hover": { bgcolor: "action.selected" },
      }}
    >
      {photoUrl ? (
        <TaxonThumbnail
          src={photoUrl}
          size={48}
          emptyBgcolor="action.disabledBackground"
          sx={{ flexShrink: 0 }}
        />
      ) : (
        <RankChip rank={ancestor.rank} />
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography sx={{ fontWeight: 600 }}>
            <AncestorName ancestor={ancestor} />
          </Typography>
          {ancestor.commonName && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {ancestor.commonName}
            </Typography>
          )}
        </Stack>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {RANK_LABEL[ancestor.rank]} ·{" "}
          {ancestor.fromServer ? `${percent}% likely` : `${percent}% match`}
        </Typography>
      </Box>
      {url && <TaxonLinkButton url={url} taxonName={ancestor.name} />}
    </ButtonBase>
  );
}

function AncestorAffordance({
  ancestor,
  onSelect,
}: {
  ancestor: AncestorMatch;
  onSelect: () => void;
}) {
  return (
    <ButtonBase
      onClick={onSelect}
      sx={{
        alignSelf: "flex-start",
        textAlign: "left",
        borderRadius: 1,
        px: 0.75,
        py: 0.5,
        mt: 0.25,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        color: "text.secondary",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <RankChip rank={ancestor.rank} size={24} />
      <Typography variant="caption">
        Pick <AncestorName ancestor={ancestor} /> instead
      </Typography>
    </ButtonBase>
  );
}

function SpeciesCard({
  suggestion,
  primary,
  onSelect,
}: {
  suggestion: SpeciesSuggestion;
  primary?: boolean;
  onSelect: () => void;
}) {
  const thumbnailSize = primary ? 48 : 40;
  const url = buildTaxonUrl(
    suggestion.scientificName,
    suggestion.kingdom,
    undefined,
    suggestion.taxonMatch?.taxonId,
  );
  return (
    <ButtonBase
      onClick={onSelect}
      sx={{
        ...SUGGESTION_ROW_BASE_SX,
        borderColor: primary ? "primary.main" : "divider",
        bgcolor: primary ? "action.hover" : "transparent",
        p: primary ? 1.25 : 1,
        minHeight: primary ? 56 : 48,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <TaxonThumbnail
        src={suggestion.taxonMatch?.photoUrl}
        size={thumbnailSize}
        emptyBgcolor="action.disabledBackground"
        sx={{ flexShrink: 0 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography sx={{ fontStyle: "italic", fontWeight: primary ? 600 : 500 }}>
            {suggestion.scientificName}
          </Typography>
          {suggestion.commonName && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {suggestion.commonName}
            </Typography>
          )}
          {suggestion.inRange === true && <InRangeIndicator />}
        </Stack>
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0 }}>
        {Math.round(suggestion.confidence * 100)}%
      </Typography>
      {url && <TaxonLinkButton url={url} taxonName={suggestion.scientificName} />}
    </ButtonBase>
  );
}
