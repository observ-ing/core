import { useState, useRef, useCallback, useEffect } from "react";
import { useTaxaSearch } from "../lib/query/hooks";
import { MAX_AUTOCOMPLETE_RESULTS } from "../lib/utils";

/**
 * Debounced taxa search, backed by the shared query cache. Typing updates a
 * debounced search term; `useTaxaSearch` fetches (and caches/dedupes) results
 * for that term. Same `{ suggestions, search, clearSuggestions }` API as before.
 */
export function useDebouncedTaxaSearch(debounceMs = 300) {
  const [term, setTerm] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const search = useCallback(
    (query: string) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setTerm(query), debounceMs);
    },
    [debounceMs],
  );

  const clearSuggestions = useCallback(() => {
    clearTimeout(timerRef.current);
    setTerm("");
  }, []);

  const { data } = useTaxaSearch(term);
  const suggestions = (data ?? []).slice(0, MAX_AUTOCOMPLETE_RESULTS);

  return { suggestions, search, clearSuggestions };
}
