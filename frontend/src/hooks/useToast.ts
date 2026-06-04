import { useCallback, useMemo } from "react";
import { useAppDispatch } from "../store";
import { addToast } from "../store/uiSlice";

type ToastType = "success" | "error";

/**
 * Thin wrapper over the `addToast` Redux action so components can show toasts
 * without importing the action + `useAppDispatch` directly. The returned object
 * and its callbacks are stable across renders.
 *
 * @returns `{ success, error, show }` toast dispatchers.
 */
export function useToast() {
  const dispatch = useAppDispatch();

  const show = useCallback(
    (message: string, type: ToastType) => {
      dispatch(addToast({ message, type }));
    },
    [dispatch],
  );

  const success = useCallback(
    (message: string) => {
      show(message, "success");
    },
    [show],
  );

  const error = useCallback(
    (message: string) => {
      show(message, "error");
    },
    [show],
  );

  return useMemo(() => ({ success, error, show }), [success, error, show]);
}
