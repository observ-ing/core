import { useState, useCallback } from "react";
import { useAppDispatch } from "../store";
import { addToast } from "../store/uiSlice";

interface UseFormSubmitOptions {
  /** Toast message shown on success. If omitted, no success toast is dispatched. */
  successMessage?: string;
  /** Called after the submit function resolves successfully (use for form reset, etc.) */
  onSuccess?: () => void | Promise<void>;
  /** Custom error handler. If provided, replaces the default error toast. */
  onError?: (error: unknown) => void;
}

/**
 * Manages the common form submission lifecycle: loading state, try/catch, and toast notifications.
 *
 * @param submitFn - Async function that performs the actual submission.
 * @param options - Optional callbacks and toast configuration.
 * @returns `isSubmitting` flag and a `handleSubmit` function.
 */
export function useFormSubmit(
  submitFn: () => Promise<unknown>,
  options: UseFormSubmitOptions = {},
) {
  const dispatch = useAppDispatch();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await submitFn();

      if (options.successMessage) {
        dispatch(addToast({ message: options.successMessage, type: "success" }));
      }

      await options.onSuccess?.();
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        dispatch(
          addToast({
            message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            type: "error",
          }),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [submitFn, options, dispatch]);

  return { isSubmitting, handleSubmit };
}
