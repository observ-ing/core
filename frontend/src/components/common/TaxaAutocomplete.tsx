import { useCallback, type ReactNode } from "react";
import { searchTaxa } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { useAutocomplete } from "../../hooks/useAutocomplete";
import { MAX_AUTOCOMPLETE_RESULTS } from "../../lib/utils";
import { TaxaAutocompleteView } from "./TaxaAutocompleteView";

interface TaxaAutocompleteProps {
  value: string;
  onChange: (name: string) => void;
  /**
   * Fires whenever the user picks a suggestion (with the full TaxaResult)
   * or types free text that no longer corresponds to a pick (with null).
   * Lets callers know whether they have authoritative taxonomy data.
   */
  onMatchChange?: (match: TaxaResult | null) => void;
  label?: string;
  placeholder?: string;
  size?: "small" | "medium";
  margin?: "normal" | "dense" | "none";
  /** Content rendered below the input field (e.g. AI suggestions) */
  bottomContent?: ReactNode;
}

export function TaxaAutocomplete(props: TaxaAutocompleteProps) {
  const searchFn = useCallback((query: string) => searchTaxa(query), []);
  const { options, loading, handleSearch, clearOptions } = useAutocomplete<TaxaResult>({
    searchFn,
    filterResults: (results) => results.slice(0, MAX_AUTOCOMPLETE_RESULTS),
  });

  return (
    <TaxaAutocompleteView
      {...props}
      options={options}
      loading={loading}
      onSearch={handleSearch}
      onClear={clearOptions}
    />
  );
}
