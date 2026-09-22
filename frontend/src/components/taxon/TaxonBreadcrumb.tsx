import type { TaxonAncestor } from "../../bindings/TaxonAncestor";
import { buildTaxonUrl } from "../../lib/taxonSlug";
import { Breadcrumbs, type BreadcrumbItem } from "../common/Breadcrumbs";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";

interface TaxonBreadcrumbProps {
  /** The ancestor path, root-first, up to (but excluding) the current taxon. */
  ancestors: TaxonAncestor[];
  /** Kingdom used to build links for non-kingdom ancestors. */
  kingdom?: string | undefined;
}

/**
 * The ancestor path shown above the taxon hero (e.g. Animalia / Arthropoda /
 * … / Vanessa). Each crumb links to its taxon page; genus/species names are
 * italicized. Renders nothing when there are no ancestors.
 */
export function TaxonBreadcrumb({ ancestors, kingdom }: TaxonBreadcrumbProps) {
  const items: BreadcrumbItem[] = ancestors.map((a) => {
    const url = buildTaxonUrl(a.name, kingdom, a.rank) ?? undefined;
    return {
      label: a.name,
      italic: shouldItalicizeTaxonName(a.name, a.rank),
      ...(url ? { href: url } : {}),
    };
  });

  return <Breadcrumbs items={items} sx={{ mb: 2.25 }} />;
}
