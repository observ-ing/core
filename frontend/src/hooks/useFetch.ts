import { useEffect, useState, type DependencyList } from "react";
import { getErrorMessage } from "../lib/utils";

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Run an async fetcher when `deps` change, with unmount-safe cancellation.
 *
 * Resets `loading` to true on every dep change. The cancelled flag prevents
 * stale results from a previous run (or after unmount) from clobbering state.
 *
 * Matches the existing manual pattern: no caching, no retries, no race tokens
 * beyond the simple cancelled flag. If the fetcher needs additional inputs,
 * close over them and include them in `deps`.
 */
export function useFetch<T>(fetcher: () => Promise<T>, deps: DependencyList): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e, "Failed to load"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies deps
  }, deps);

  return { data, loading, error };
}
