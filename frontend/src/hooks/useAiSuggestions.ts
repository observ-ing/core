import { useState, useEffect, useRef } from "react";
import { identifySpecies, type SpeciesSuggestion } from "../services/api";
import { useAppDispatch } from "../store";
import { addToast } from "../store/uiSlice";

interface UseAiSuggestionsOptions {
  imageUrl: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  disabled?: boolean | undefined;
  /** Automatically fetch suggestions on mount */
  autoFetch?: boolean | undefined;
  /** Suppress error toasts (e.g. for best-effort background identification) */
  quiet?: boolean | undefined;
}

export function useAiSuggestions({
  imageUrl,
  latitude,
  longitude,
  autoFetch,
  quiet,
}: UseAiSuggestionsOptions) {
  const dispatch = useAppDispatch();
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchedRef = useRef(false);

  const handleFetch = async () => {
    setIsLoading(true);
    setSuggestions([]);
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
        reader.readAsDataURL(blob);
      });

      const params: Parameters<typeof identifySpecies>[0] = {
        image: base64,
        limit: 5,
      };
      if (latitude != null && Number.isFinite(latitude)) params.latitude = latitude;
      if (longitude != null && Number.isFinite(longitude)) params.longitude = longitude;

      const result = await identifySpecies(params);
      setSuggestions(result.suggestions);
      setHasLoaded(true);
      if (result.suggestions.length === 0 && !quiet) {
        dispatch(addToast({ message: "No species suggestions found", type: "success" }));
      }
    } catch {
      if (!quiet) {
        dispatch(addToast({ message: "Species identification unavailable", type: "error" }));
      }
      setHasLoaded(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (autoFetch && !fetchedRef.current) {
      fetchedRef.current = true;
      handleFetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return { suggestions, isLoading, hasLoaded, handleFetch };
}
