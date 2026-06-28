import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchTaxa } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { useAutocomplete } from "../../hooks/useAutocomplete";
import { MAX_AUTOCOMPLETE_RESULTS } from "../../lib/utils";
import { TaxaAutocompleteView, taxonUrlFor } from "../common/TaxaAutocompleteView";

interface TaxonSearchBoxProps {
  /** Called after a successful navigation (e.g. to close the mobile tree drawer). */
  onNavigate?: (() => void) | undefined;
}

/**
 * Search box for the taxon explorer's classification sidebar. Reuses the
 * shared taxa autocomplete query; picking a suggestion navigates to that
 * taxon's page.
 */
export function TaxonSearchBox({ onNavigate }: TaxonSearchBoxProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const { options, loading, handleSearch, clearOptions } = useAutocomplete<TaxaResult>({
    searchFn: searchTaxa,
    filterResults: (results) => results.slice(0, MAX_AUTOCOMPLETE_RESULTS),
  });

  const handleMatch = (match: TaxaResult | null) => {
    if (!match) return;
    const url = taxonUrlFor(match);
    if (!url) return;
    setValue("");
    clearOptions();
    onNavigate?.();
    navigate(url);
  };

  return (
    <TaxaAutocompleteView
      value={value}
      onChange={setValue}
      onMatchChange={handleMatch}
      label="Search taxa"
      placeholder="Search taxa"
      size="small"
      margin="none"
      search
      options={options}
      loading={loading}
      onSearch={handleSearch}
      onClear={clearOptions}
    />
  );
}
