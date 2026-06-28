import { useState } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import { TaxonAccordion } from "./TaxonAccordion";
import { WikiCommonsGallery } from "../common/WikiCommonsGallery";

interface TaxonMediaAccordionProps {
  /** Scientific name used to query Wikimedia Commons for images. */
  scientificName: string;
  sx?: SxProps<Theme>;
}

/**
 * Collapsible "Media" section. The (network-heavy) Wikimedia Commons gallery is
 * mounted lazily the first time the section is expanded.
 */
export function TaxonMediaAccordion({ scientificName, sx }: TaxonMediaAccordionProps) {
  const [mounted, setMounted] = useState(false);

  return (
    <TaxonAccordion
      title="Media"
      sx={sx}
      onChange={(expanded) => {
        if (expanded) setMounted(true);
      }}
    >
      {mounted ? <WikiCommonsGallery taxonName={scientificName} /> : null}
    </TaxonAccordion>
  );
}
