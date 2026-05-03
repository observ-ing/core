import { Box, ButtonBase, IconButton, Stack, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlaceIcon from "@mui/icons-material/Place";
import type { SpeciesSuggestion } from "../../services/api";
import { nameToSlug } from "../../lib/taxonSlug";

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
  /** Sum of candidate confidences — what the model would say at this rank. */
  confidence: number;
}

export interface AncestorSelection {
  rank: AncestorRank;
  name: string;
  kingdom: string | undefined;
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

function buildTaxonUrl(
  name: string,
  kingdom: string | undefined,
  rank?: AncestorRank,
): string | null {
  if (rank === "kingdom") return `/taxon/${nameToSlug(name)}`;
  if (kingdom) return `/taxon/${nameToSlug(kingdom)}/${nameToSlug(name)}`;
  return null;
}

function TaxonLinkButton({ url }: { url: string }) {
  return (
    <IconButton
      size="small"
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      sx={{ p: 0.5, ml: 0.5, flexShrink: 0 }}
      title="Open taxon in new tab"
    >
      <OpenInNewIcon sx={{ fontSize: 14 }} />
    </IconButton>
  );
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
  onSelectSpecies: (suggestion: SpeciesSuggestion) => void;
  onSelectAncestor: (ancestor: AncestorSelection) => void;
}

export function VisualIdCards({
  suggestions,
  onSelectSpecies,
  onSelectAncestor,
}: VisualIdCardsProps) {
  if (suggestions.length === 0) return null;

  const sorted = [...suggestions].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  if (!top) return null;
  const rest = sorted.slice(1);
  const mode = determineMode(sorted);
  const ancestor = mode !== "single" ? findCommonAncestor(sorted) : null;

  const ancestorSelection = ancestor
    ? { rank: ancestor.rank, name: ancestor.name, kingdom: ancestor.kingdom }
    : null;

  return (
    <Box>
      <SectionHeader />
      {mode === "single" && (
        <SpeciesCard suggestion={top} primary onSelect={() => onSelectSpecies(top)} />
      )}

      {mode === "dominant" && (
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
          <SectionLabel text={ancestor ? "If you can tell which species:" : "Possible species:"} />
          <Stack spacing={0.5}>
            {sorted.map((s) => (
              <SpeciesCard
                key={s.scientificName}
                suggestion={s}
                onSelect={() => onSelectSpecies(s)}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

function SectionHeader() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
      <AutoFixHighIcon sx={{ fontSize: 14, color: "text.secondary" }} />
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
  const url = buildTaxonUrl(ancestor.name, ancestor.kingdom, ancestor.rank);
  return (
    <ButtonBase
      onClick={onSelect}
      sx={{
        width: "100%",
        textAlign: "left",
        borderRadius: 1,
        border: "1px solid",
        borderColor: "primary.main",
        bgcolor: "action.hover",
        p: 1.25,
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        minHeight: 64,
        "&:hover": { bgcolor: "action.selected" },
      }}
    >
      <RankChip rank={ancestor.rank} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }}>
          <AncestorName ancestor={ancestor} />
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {RANK_LABEL[ancestor.rank]} · {Math.round(ancestor.confidence * 100)}% match
        </Typography>
      </Box>
      {url && <TaxonLinkButton url={url} />}
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
  const url = buildTaxonUrl(suggestion.scientificName, suggestion.kingdom);
  return (
    <ButtonBase
      onClick={onSelect}
      sx={{
        width: "100%",
        textAlign: "left",
        borderRadius: 1,
        border: "1px solid",
        borderColor: primary ? "primary.main" : "divider",
        bgcolor: primary ? "action.hover" : "transparent",
        p: primary ? 1.25 : 1,
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        minHeight: primary ? 56 : 48,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {suggestion.taxonMatch?.photoUrl ? (
        <Box
          component="img"
          src={suggestion.taxonMatch.photoUrl}
          alt=""
          loading="lazy"
          sx={{
            width: thumbnailSize,
            height: thumbnailSize,
            borderRadius: 1,
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
      ) : (
        <Box
          sx={{
            width: thumbnailSize,
            height: thumbnailSize,
            borderRadius: 1,
            bgcolor: "action.disabledBackground",
            flexShrink: 0,
          }}
        />
      )}
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
          {suggestion.inRange === true && (
            <Box
              component="span"
              sx={{ display: "inline-flex", alignItems: "center", color: "success.main" }}
              title="Found in your area"
              aria-label="Found in your area"
            >
              <PlaceIcon sx={{ fontSize: 14 }} />
            </Box>
          )}
        </Stack>
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0 }}>
        {Math.round(suggestion.confidence * 100)}%
      </Typography>
      {url && <TaxonLinkButton url={url} />}
    </ButtonBase>
  );
}
