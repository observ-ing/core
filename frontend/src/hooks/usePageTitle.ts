import { useEffect } from "react";

const BASE_TITLE = "Observ.ing";

/**
 * Sets the document title. Resets to base title on unmount.
 */
export function usePageTitle(subtitle?: string | null) {
  useEffect(() => {
    document.title = subtitle ? `${subtitle} - ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [subtitle]);
}
