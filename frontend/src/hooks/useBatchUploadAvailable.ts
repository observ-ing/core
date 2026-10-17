import { Capacitor } from "@capacitor/core";

/**
 * Whether to offer the batch uploader. It has a layout for a mouse and one for
 * touch (#887), so any browser gets it. The native app does not yet: its photo
 * picker, the only one that keeps a photo's GPS position on Android, hands
 * over one photo at a time.
 */
export function useBatchUploadAvailable(): boolean {
  return !Capacitor.isNativePlatform();
}
