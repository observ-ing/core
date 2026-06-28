import { useState } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import { CollapsibleSection } from "../common/CollapsibleSection";
import { WikiCommonsGallery } from "../common/WikiCommonsGallery";

interface TaxonMediaSectionProps {
  /** Scientific name used to query Wikimedia Commons for images. */
  scientificName: string;
  sx?: SxProps<Theme>;
}

/**
 * Collapsible "Media" section. The (network-heavy) Wikimedia Commons gallery is
 * mounted lazily the first time the section is expanded.
 */
export function TaxonMediaSection({ scientificName, sx }: TaxonMediaSectionProps) {
  const [mounted, setMounted] = useState(false);

  return (
    <CollapsibleSection
      title="Media"
      icon={<CollectionsOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />}
      onFirstExpand={() => setMounted(true)}
      sx={sx}
    >
      {mounted ? <WikiCommonsGallery taxonName={scientificName} /> : null}
    </CollapsibleSection>
  );
}
