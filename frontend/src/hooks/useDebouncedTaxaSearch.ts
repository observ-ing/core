import { useCallback } from "react";
import { searchTaxa } from "../services/api";
import type { TaxaResult } from "../services/types";
import { MAX_AUTOCOMPLETE_RESULTS } from "../lib/utils";
import { useAutocomplete } from "./useAutocomplete";

/**
 * Debounced taxa search hook. Waits for the user to stop typing before
 * firing the API request, preventing a burst of concurrent requests on
 * every keystroke.
 */
export function useDebouncedTaxaSearch(debounceMs = 300) {
  const searchFn = useCallback((query: string) => searchTaxa(query), []);
  const {
    options: suggestions,
    handleSearch: search,
    clearOptions: clearSuggestions,
  } = useAutocomplete<TaxaResult>({
    searchFn,
    filterResults: (results) => results.slice(0, MAX_AUTOCOMPLETE_RESULTS),
    debounceMs,
  });

  return { suggestions, search, clearSuggestions };
}
