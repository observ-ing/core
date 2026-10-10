import { useMediaQuery } from "@mui/material";
import { Capacitor } from "@capacitor/core";

/**
 * Whether to offer the batch uploader. It is built around drag and drop, so it
 * needs a precise pointer: a narrow desktop window qualifies, a phone or tablet
 * browser does not, and neither does the native app.
 */
export function useBatchUploadAvailable(): boolean {
  const finePointer = useMediaQuery("(pointer: fine)");
  return finePointer && !Capacitor.isNativePlatform();
}
