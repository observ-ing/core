import { Box, LinearProgress } from "@mui/material";
import type { TaxonDetail as TaxonDetailType, Occurrence } from "../../services/types";
import { TaxonHeroCard } from "./TaxonHeroCard";
import { TaxonDetailHeader } from "./TaxonDetailHeader";
import { TaxonBreadcrumb } from "./TaxonBreadcrumb";
import { TaxonMediaSection } from "./TaxonMediaSection";
import { TaxonDescriptionSection } from "./TaxonDescriptionSection";
import { TaxonReferencesSection } from "./TaxonReferencesSection";
import { TaxonObservations } from "./TaxonObservations";

interface TaxonDetailPanelProps {
  taxon: TaxonDetailType;
  heroUrl?: string | undefined;
  observations: Occurrence[];
  hasMore: boolean;
  loadingMore: boolean;
  /** A newly-selected taxon is loading; the still-visible content is stale. */
  loading?: boolean;
  onLoadMore: () => void;
  onBack: () => void;
  onToggleTree?: () => void;
}

/**
 * The taxon detail page: a sticky header, then a centered column with the
 * breadcrumb, hero, the Media/Description/References sections, and recent
 * observations. Composition only — each section lives in its own component.
 */
export function TaxonDetailPanel({
  taxon,
  heroUrl,
  observations,
  hasMore,
  loadingMore,
  loading = false,
  onLoadMore,
  onBack,
  onToggleTree,
}: TaxonDetailPanelProps) {
  return (
    <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      <TaxonDetailHeader rank={taxon.rank} onBack={onBack} onToggleTree={onToggleTree} />
      {/* While a newly-selected taxon loads we keep the previous one visible
          (no empty flash) but signal the swap: a progress bar pinned below the
          header, plus a dimmed, inert content area — mirroring how the
          classification tree is disabled during the same load. */}
      {loading && <LinearProgress sx={{ position: "sticky", top: 0, zIndex: 2 }} />}
      <Box
        sx={{
          opacity: loading ? 0.5 : 1,
          pointerEvents: loading ? "none" : "auto",
          transition: "opacity 0.2s",
        }}
      >
        {/* Constrained + centered to match the design's reading width. */}
        <Box sx={{ maxWidth: 960, mx: "auto", px: { xs: 2, sm: 4 }, pt: 3.5, pb: 7.5 }}>
          <TaxonBreadcrumb ancestors={taxon.ancestors} kingdom={taxon.kingdom} />

          <TaxonHeroCard taxon={taxon} heroUrl={heroUrl} />

          <TaxonMediaSection scientificName={taxon.scientificName} sx={{ mt: 3.25 }} />

          {taxon.descriptions && taxon.descriptions.length > 0 && (
            <TaxonDescriptionSection descriptions={taxon.descriptions} sx={{ mt: 2 }} />
          )}

          {taxon.references && taxon.references.length > 0 && (
            <TaxonReferencesSection references={taxon.references} sx={{ mt: 2 }} />
          )}

          <TaxonObservations
            observations={observations}
            hasMore={hasMore}
            loadingMore={loadingMore}
            emptyName={taxon.commonName || taxon.scientificName}
            onLoadMore={onLoadMore}
          />
        </Box>
      </Box>
    </Box>
  );
}
