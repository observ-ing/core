import { useState, useCallback, useRef, useEffect } from "react";

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MIN_LENGTH = 2;

interface UseAutocompleteOptions<T> {
  /** The async function that fetches results for a query */
  searchFn: (query: string) => Promise<T[]>;
  /** Optional transform applied to results before setting state */
  filterResults?: (results: T[]) => T[];
  /** Minimum query length before searching (default: 2) */
  minLength?: number;
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
}

interface UseAutocompleteReturn<T> {
  options: T[];
  loading: boolean;
  handleSearch: (query: string) => void;
  clearOptions: () => void;
}

export function useAutocomplete<T>({
  searchFn,
  filterResults,
  minLength = DEFAULT_MIN_LENGTH,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseAutocompleteOptions<T>): UseAutocompleteReturn<T> {
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const latestQuery = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      latestQuery.current = query;
      clearTimeout(timerRef.current);

      if (query.length < minLength) {
        setOptions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      timerRef.current = setTimeout(async () => {
        const results = await searchFn(query);
        if (latestQuery.current === query) {
          setOptions(filterResults ? filterResults(results) : results);
          setLoading(false);
        }
      }, debounceMs);
    },
    [searchFn, filterResults, minLength, debounceMs],
  );

  const clearOptions = useCallback(() => {
    clearTimeout(timerRef.current);
    setOptions([]);
    setLoading(false);
  }, []);

  return { options, loading, handleSearch, clearOptions };
}
