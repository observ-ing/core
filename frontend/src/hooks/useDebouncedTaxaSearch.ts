import { useState, useRef, useCallback, useEffect } from "react";
import { searchTaxa } from "../services/api";
import type { TaxaResult } from "../services/types";

/**
 * Debounced taxa search hook. Waits for the user to stop typing before
 * firing the API request, preventing a burst of concurrent requests on
 * every keystroke.
 */
export function useDebouncedTaxaSearch(debounceMs = 300) {
  const [suggestions, setSuggestions] = useState<TaxaResult[]>([]);
  const latestQuery = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback(
    (value: string) => {
      latestQuery.current = value;
      clearTimeout(timerRef.current);

      if (value.length < 2) {
        setSuggestions([]);
        return;
      }

      timerRef.current = setTimeout(async () => {
        const results = await searchTaxa(value);
        if (latestQuery.current === value) {
          setSuggestions(results.slice(0, 5));
        }
      }, debounceMs);
    },
    [debounceMs],
  );

  const clearSuggestions = useCallback(() => {
    clearTimeout(timerRef.current);
    setSuggestions([]);
  }, []);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return { suggestions, search, clearSuggestions };
}
